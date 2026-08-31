import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { getOnShiftMembers } from './domain/shifts.js';
import { normaliseGroup } from './domain/shiftGroups.js';
import { matchingRules, ruleMatches } from './engine/rules.js';
import { evaluateAssignment } from './engine/assignment.js';
import { cooldownMinutesForRule, deriveEventTriggers, executionIsCoolingDown } from './engine/triggers.js';

const resolver = new Resolver();
const SHIFT_PREFIX = 'shift-group:';
const RULE_PREFIX = 'assignment-rule:';
const AUDIT_PREFIX = 'assignment-audit:';
const ROTATION_PREFIX = 'rotation:';
const EXECUTION_PREFIX = 'execution:';
const SHIFT_STATE_PREFIX = 'shift-state:';

function jiraClient(actor = 'user') {
  return actor === 'app' ? api.asApp() : api.asUser();
}

async function assertAdmin() {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!response.ok) throw new Error(`Unable to verify Jira admin permission (${response.status})`);
  const body = await response.json();
  if (!body?.permissions?.ADMINISTER?.havePermission) throw new Error('Jira administrator permission is required.');
}

async function listByPrefix(prefix, limit = 100) {
  const result = await kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(limit).getMany();
  return (result.results || []).map(item => item.value);
}

async function listShiftGroups() { return listByPrefix(SHIFT_PREFIX, 100); }

async function describeUsers(accountIds = [], storedProfiles = []) {
  const stored = Object.fromEntries((storedProfiles || []).filter(p => p?.accountId).map(p => [p.accountId, p.displayName || p.accountId]));
  const unresolved = accountIds.filter(id => !stored[id]);
  const lookedUp = await Promise.all(unresolved.map(async accountId => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
      if (!response.ok) return [accountId, accountId];
      const user = await response.json();
      return [accountId, user.displayName || accountId];
    } catch { return [accountId, accountId]; }
  }));
  return { ...stored, ...Object.fromEntries(lookedUp) };
}

function memberProfilesFromPayload(group = {}) {
  return [...new Map((group.memberProfiles || []).filter(p => p?.accountId).map(p => [p.accountId, {
    accountId: String(p.accountId), displayName: String(p.displayName || p.accountId)
  }])).values()];
}

function enrichGroup(group, at = new Date()) {
  const onShiftIds = getOnShiftMembers({ shiftGroup: group, at, overrides: group.overrides || [] });
  const profileMap = Object.fromEntries((group.memberProfiles || []).map(p => [p.accountId, p.displayName]));
  return {
    ...group,
    members: (group.memberAccountIds || []).map(accountId => ({ accountId, displayName: profileMap[accountId] || accountId })),
    onShift: onShiftIds.map(accountId => ({ accountId, displayName: profileMap[accountId] || accountId })),
    memberCount: group.memberAccountIds?.length || 0
  };
}

function toIssueModel(issue) {
  const fields = issue?.fields || {};
  return {
    key: issue?.key,
    projectId: String(fields.project?.id || ''),
    issueTypeId: String(fields.issuetype?.id || ''),
    requestTypeId: String(fields.customfield_10010?.requestType?.id || fields.customfield_10010 || ''),
    statusId: String(fields.status?.id || ''),
    priorityId: String(fields.priority?.id || ''),
    assigneeAccountId: fields.assignee?.accountId || null,
    reporterAccountId: fields.reporter?.accountId || null,
    labels: fields.labels || [],
    componentIds: (fields.components || []).map(c => String(c.id)),
    fields
  };
}

async function getIssue(issueKey, actor = 'user') {
  const res = await jiraClient(actor).requestJira(route`/rest/api/3/issue/${issueKey}`);
  if (!res.ok) throw new Error(`Unable to load ${issueKey} (${res.status})`);
  return res.json();
}

async function searchIssues(jql, actor = 'app', maxResults = 50) {
  const res = await jiraClient(actor).requestJira(route`/rest/api/3/search?jql=${jql}&maxResults=${maxResults}&fields=key`);
  if (!res.ok) throw new Error(`Unable to search Jira (${res.status})`);
  const body = await res.json();
  return body.issues || [];
}

async function countOpenAssigned(accountIds = [], projectIds = [], actor = 'user') {
  const entries = await Promise.all(accountIds.map(async accountId => {
    try {
      const projectClause = projectIds.length ? ` AND project in (${projectIds.join(',')})` : '';
      const jql = `assignee = "${accountId}" AND statusCategory != Done${projectClause}`;
      const res = await jiraClient(actor).requestJira(route`/rest/api/3/search?jql=${jql}&maxResults=0`);
      if (!res.ok) return [accountId, 0];
      const body = await res.json();
      return [accountId, body.total || 0];
    } catch { return [accountId, 0]; }
  }));
  return Object.fromEntries(entries);
}

async function audit(entry) {
  const createdAt = new Date().toISOString();
  const id = `${createdAt}:${Math.random().toString(36).slice(2)}`;
  await kvs.set(`${AUDIT_PREFIX}${id}`, { id, createdAt, ...entry });
}

function profileNames(groups = []) {
  return Object.fromEntries(groups.flatMap(g => g.memberProfiles || []).map(p => [p.accountId, p.displayName]));
}

async function evaluateRule({ rule, jiraIssue, actor = 'user' }) {
  const issue = toIssueModel(jiraIssue);
  const groups = (await listShiftGroups()).filter(g => (rule.shiftGroupIds || []).includes(g.id));
  const at = new Date();
  const eligible = [...new Set(groups.flatMap(g => getOnShiftMembers({ shiftGroup: g, at, overrides: g.overrides || [] })))];
  const loads = await countOpenAssigned(eligible, rule.projectIds || [], actor);
  const lastAssignedAccountId = await kvs.get(`${ROTATION_PREFIX}${rule.id}`);

  let result;
  if (rule.trigger === 'shiftEnd' && rule.shiftEndPolicy === 'keep') {
    result = { action: 'keep', assigneeAccountId: issue.assigneeAccountId, reason: 'SHIFT_END_KEEP' };
  } else if (rule.trigger === 'shiftEnd' && rule.shiftEndPolicy === 'unassign') {
    result = issue.assigneeAccountId
      ? { action: 'unassign', reason: 'SHIFT_END_UNASSIGN' }
      : { action: 'none', reason: 'ALREADY_UNASSIGNED' };
  } else {
    result = evaluateAssignment({ rule, issue, eligibleAccountIds: eligible, loads, lastAssignedAccountId });
    if (result.action === 'none' && result.reason === 'NO_ELIGIBLE_AGENT' && rule.noAgentPolicy === 'unassign' && issue.assigneeAccountId) {
      result = { action: 'unassign', reason: 'NO_ELIGIBLE_AGENT_UNASSIGN' };
    }
  }

  const names = profileNames(groups);
  return {
    issueKey: issue.key,
    matchedRule: rule,
    result,
    eligible: eligible.map(accountId => ({ accountId, displayName: names[accountId] || accountId, load: loads[accountId] || 0 }))
  };
}

async function simulateInternal({ issueKey, trigger = 'issueCreated', actor = 'user' }) {
  const jiraIssue = await getIssue(issueKey, actor);
  const issue = toIssueModel(jiraIssue);
  const rules = await listByPrefix(RULE_PREFIX, 100);
  const matched = matchingRules({ rules, trigger, issue });
  if (!matched.length) return { issueKey, trigger, matchedRule: null, result: { action: 'none', reason: 'NO_MATCHING_RULE' }, eligible: [] };
  return { trigger, ...(await evaluateRule({ rule: matched[0], jiraIssue, actor })) };
}

async function simulateTriggersInternal({ issueKey, triggers = [], actor = 'app' }) {
  const jiraIssue = await getIssue(issueKey, actor);
  const issue = toIssueModel(jiraIssue);
  const rules = await listByPrefix(RULE_PREFIX, 100);
  const candidates = rules
    .filter(rule => triggers.includes(rule.trigger) && ruleMatches({ rule, trigger: rule.trigger, issue }))
    .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
  if (!candidates.length) return { issueKey, triggers, matchedRule: null, result: { action: 'none', reason: 'NO_MATCHING_RULE' }, eligible: [] };
  return { triggers, ...(await evaluateRule({ rule: candidates[0], jiraIssue, actor })) };
}

async function executeSimulation(simulation, { actor = 'user', source = 'manual-execute', respectCooldown = false } = {}) {
  const rule = simulation.matchedRule;
  if (!rule) return { ...simulation, executed: false };

  const issueKey = simulation.issueKey;
  const now = new Date();
  const ruleExecutionKey = `${EXECUTION_PREFIX}${rule.id}:${issueKey}`;
  const issueExecutionKey = `${EXECUTION_PREFIX}issue:${issueKey}`;
  if (respectCooldown) {
    const [lastRuleRun, lastIssueRun] = await Promise.all([kvs.get(ruleExecutionKey), kvs.get(issueExecutionKey)]);
    const cooldown = cooldownMinutesForRule(rule);
    if (executionIsCoolingDown({ lastExecutedAt: lastRuleRun, now, cooldownMinutes: cooldown }) || executionIsCoolingDown({ lastExecutedAt: lastIssueRun, now, cooldownMinutes: 2 })) {
      return { ...simulation, executed: false, skipped: true, skipReason: 'COOLDOWN' };
    }
  }

  const result = simulation.result || {};
  if (!['assign', 'unassign'].includes(result.action)) {
    if (respectCooldown && result.reason === 'NO_ELIGIBLE_AGENT') {
      await kvs.set(ruleExecutionKey, now.toISOString());
      await audit({ issueKey, ruleId: rule.id, ruleName: rule.name, action: 'none', assigneeAccountId: null, reason: result.reason, source });
    }
    return { ...simulation, executed: false };
  }

  const accountId = result.action === 'assign' ? result.assigneeAccountId : null;
  const res = await jiraClient(actor).requestJira(route`/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Atlassian-Webhook-Trace': `nuvriqo-shift-${rule.id}` },
    body: JSON.stringify({ accountId })
  });
  if (!res.ok) throw new Error(`Unable to update assignee for ${issueKey} (${res.status})`);

  if (accountId) await kvs.set(`${ROTATION_PREFIX}${rule.id}`, accountId);
  await Promise.all([kvs.set(ruleExecutionKey, now.toISOString()), kvs.set(issueExecutionKey, now.toISOString())]);
  await audit({ issueKey, ruleId: rule.id, ruleName: rule.name, action: result.action, assigneeAccountId: accountId, reason: result.reason, source });
  return { ...simulation, executed: true };
}

function projectJql(rule = {}) {
  return rule.projectIds?.length ? `project in (${rule.projectIds.join(',')}) AND ` : '';
}

function quoteJqlField(value = '') {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

async function scanTemporalRules() {
  const rules = (await listByPrefix(RULE_PREFIX, 100))
    .filter(rule => rule.enabled && ['untouched', 'slaThreshold'].includes(rule.trigger))
    .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));

  for (const rule of rules) {
    let jql;
    if (rule.trigger === 'untouched') {
      const minutes = Math.max(5, Number(rule.untouchedMinutes || 60));
      jql = `${projectJql(rule)}statusCategory != Done AND updated <= -${minutes}m`;
    } else {
      if (!rule.slaFieldName) continue;
      const minutes = Math.max(1, Number(rule.slaThresholdMinutes || 30));
      const field = quoteJqlField(rule.slaFieldName);
      jql = `${projectJql(rule)}statusCategory != Done AND ${field} < remaining("${minutes}m") AND ${field} >= remaining("0m")`;
    }

    const issues = await searchIssues(jql, 'app', 50);
    for (const item of issues) {
      const jiraIssue = await getIssue(item.key, 'app');
      const issue = toIssueModel(jiraIssue);
      if (!ruleMatches({ rule, trigger: rule.trigger, issue })) continue;
      const simulation = { trigger: rule.trigger, ...(await evaluateRule({ rule, jiraIssue, actor: 'app' })) };
      await executeSimulation(simulation, { actor: 'app', source: `scheduled:${rule.trigger}`, respectCooldown: true });
    }
  }
}

async function scanShiftTransitions() {
  const now = new Date();
  const groups = await listShiftGroups();
  const rules = (await listByPrefix(RULE_PREFIX, 100)).filter(r => r.enabled && ['shiftStart', 'shiftEnd'].includes(r.trigger));

  for (const group of groups) {
    const current = getOnShiftMembers({ shiftGroup: group, at: now, overrides: group.overrides || [] });
    const stateKey = `${SHIFT_STATE_PREFIX}${group.id}`;
    const previousState = await kvs.get(stateKey);
    await kvs.set(stateKey, { at: now.toISOString(), onShift: current });
    if (!previousState?.onShift) continue;

    const previous = previousState.onShift || [];
    const started = current.filter(id => !previous.includes(id));
    const ended = previous.filter(id => !current.includes(id));

    if (ended.length) {
      const relevant = rules.filter(r => r.trigger === 'shiftEnd' && (r.shiftGroupIds || []).includes(group.id)).sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
      for (const rule of relevant) {
        const assignees = ended.map(id => `"${id}"`).join(',');
        const jql = `${projectJql(rule)}statusCategory != Done AND assignee in (${assignees})`;
        const issues = await searchIssues(jql, 'app', 50);
        for (const item of issues) {
          const simulation = await simulateInternal({ issueKey: item.key, trigger: 'shiftEnd', actor: 'app' });
          await executeSimulation(simulation, { actor: 'app', source: 'scheduled:shiftEnd', respectCooldown: true });
        }
      }
    }

    if (started.length) {
      const relevant = rules.filter(r => r.trigger === 'shiftStart' && (r.shiftGroupIds || []).includes(group.id)).sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
      for (const rule of relevant) {
        const jql = `${projectJql(rule)}statusCategory != Done AND assignee is EMPTY`;
        const issues = await searchIssues(jql, 'app', 50);
        for (const item of issues) {
          const simulation = await simulateInternal({ issueKey: item.key, trigger: 'shiftStart', actor: 'app' });
          await executeSimulation(simulation, { actor: 'app', source: 'scheduled:shiftStart', respectCooldown: true });
        }
      }
    }
  }
}

resolver.define('getDashboard', async () => {
  await assertAdmin();
  const groups = await listShiftGroups();
  const at = new Date();
  const enriched = [];
  for (const group of groups) {
    const ids = group.memberAccountIds || [];
    const names = await describeUsers(ids, group.memberProfiles || []);
    const memberProfiles = ids.map(accountId => ({ accountId, displayName: names[accountId] || accountId }));
    const changed = JSON.stringify(memberProfiles) !== JSON.stringify(group.memberProfiles || []);
    const persisted = changed ? { ...group, memberProfiles } : group;
    if (changed) await kvs.set(`${SHIFT_PREFIX}${group.id}`, persisted);
    enriched.push(enrichGroup(persisted, at));
  }
  const rules = (await listByPrefix(RULE_PREFIX, 100)).sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
  return { generatedAt: at.toISOString(), groups: enriched, rules, onShiftCount: enriched.reduce((sum, g) => sum + g.onShift.length, 0), enabledRuleCount: rules.filter(r => r.enabled).length };
});

resolver.define('getRoster', async ({ payload }) => {
  await assertAdmin();
  const startAt = new Date(payload?.startAt || Date.now());
  if (Number.isNaN(startAt.getTime())) throw new Error('Invalid roster start date.');
  const days = Math.min(Math.max(Number(payload?.days || 7), 1), 31);
  const groups = await listShiftGroups();
  const slots = [];
  for (let d = 0; d < days; d += 1) {
    for (const hour of [0, 6, 9, 12, 15, 18, 21]) {
      const at = new Date(startAt);
      at.setUTCDate(startAt.getUTCDate() + d);
      at.setUTCHours(hour, 0, 0, 0);
      const people = groups.flatMap(group => enrichGroup(group, at).onShift.map(user => ({ ...user, groupId: group.id, groupName: group.name })));
      slots.push({ at: at.toISOString(), people });
    }
  }
  return { startAt: startAt.toISOString(), days, slots };
});

resolver.define('saveShiftGroup', async ({ payload }) => {
  await assertAdmin();
  const raw = payload?.group || {};
  const group = normaliseGroup(raw);
  group.memberProfiles = memberProfilesFromPayload(raw);
  group.overrides = Array.isArray(raw.overrides) ? raw.overrides : [];
  await kvs.set(`${SHIFT_PREFIX}${group.id}`, group);
  return group;
});

resolver.define('deleteShiftGroup', async ({ payload }) => {
  await assertAdmin();
  const id = String(payload?.id || '').trim();
  if (!id) throw new Error('Shift group id is required.');
  await kvs.delete(`${SHIFT_PREFIX}${id}`);
  return { ok: true };
});

resolver.define('saveAssignmentRule', async ({ payload }) => {
  await assertAdmin();
  const raw = payload?.rule || {};
  const id = String(raw.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
  const now = new Date().toISOString();
  const rule = {
    id,
    name: String(raw.name || '').trim(),
    enabled: raw.enabled !== false,
    priority: Math.max(1, Number(raw.priority || 100)),
    trigger: String(raw.trigger || 'issueCreated'),
    projectIds: (raw.projectIds || []).map(String).filter(Boolean),
    conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
    shiftGroupIds: (raw.shiftGroupIds || []).map(String).filter(Boolean),
    assignmentStrategy: String(raw.assignmentStrategy || 'roundRobin'),
    fixedOrder: (raw.fixedOrder || []).map(String).filter(Boolean),
    forceReassign: Boolean(raw.forceReassign),
    shiftEndPolicy: String(raw.shiftEndPolicy || 'reassign'),
    noAgentPolicy: String(raw.noAgentPolicy || 'leaveUnassigned'),
    slaFieldName: String(raw.slaFieldName || '').trim(),
    slaThresholdMinutes: raw.slaThresholdMinutes == null ? null : Number(raw.slaThresholdMinutes),
    untouchedMinutes: raw.untouchedMinutes == null ? null : Number(raw.untouchedMinutes),
    updatedAt: now,
    createdAt: raw.createdAt || now
  };
  if (!rule.name) throw new Error('Rule name is required.');
  if (!rule.shiftGroupIds.length) throw new Error('Select at least one shift group.');
  if (rule.trigger === 'slaThreshold' && !rule.slaFieldName) throw new Error('SLA field name is required for an SLA threshold rule.');
  await kvs.set(`${RULE_PREFIX}${id}`, rule);
  return rule;
});

resolver.define('toggleAssignmentRule', async ({ payload }) => {
  await assertAdmin();
  const id = String(payload?.id || '').trim();
  const existing = await kvs.get(`${RULE_PREFIX}${id}`);
  if (!existing) throw new Error('Assignment rule not found.');
  const updated = { ...existing, enabled: payload?.enabled !== false, updatedAt: new Date().toISOString() };
  await kvs.set(`${RULE_PREFIX}${id}`, updated);
  return updated;
});

resolver.define('deleteAssignmentRule', async ({ payload }) => {
  await assertAdmin();
  const id = String(payload?.id || '').trim();
  if (!id) throw new Error('Rule id is required.');
  await kvs.delete(`${RULE_PREFIX}${id}`);
  return { ok: true };
});

resolver.define('simulateAssignment', async ({ payload }) => {
  await assertAdmin();
  const issueKey = String(payload?.issueKey || '').trim().toUpperCase();
  const trigger = String(payload?.trigger || 'issueCreated');
  if (!issueKey) throw new Error('Issue key is required.');
  return simulateInternal({ issueKey, trigger, actor: 'user' });
});

resolver.define('executeAssignment', async ({ payload }) => {
  await assertAdmin();
  const issueKey = String(payload?.issueKey || '').trim().toUpperCase();
  const trigger = String(payload?.trigger || 'issueCreated');
  if (!issueKey) throw new Error('Issue key is required.');
  const simulation = await simulateInternal({ issueKey, trigger, actor: 'user' });
  return executeSimulation(simulation, { actor: 'user', source: 'manual-execute', respectCooldown: false });
});

resolver.define('getAuditLog', async () => {
  await assertAdmin();
  return (await listByPrefix(AUDIT_PREFIX, 100)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
});

resolver.define('health', async () => ({ ok: true, version: '0.5.0', time: new Date().toISOString() }));

export async function jiraEventHandler(event) {
  const triggers = deriveEventTriggers(event);
  const issueKey = String(event?.issue?.key || '').trim().toUpperCase();
  if (!issueKey || !triggers.length) return;
  const simulation = await simulateTriggersInternal({ issueKey, triggers, actor: 'app' });
  await executeSimulation(simulation, { actor: 'app', source: `event:${event.eventType}`, respectCooldown: true });
}

export async function scheduledHandler() {
  await scanShiftTransitions();
  await scanTemporalRules();
}

export const handler = resolver.getDefinitions();
