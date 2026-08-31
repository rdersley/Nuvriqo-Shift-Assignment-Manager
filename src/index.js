import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { getOnShiftMembers } from './domain/shifts.js';
import { normaliseGroup } from './domain/shiftGroups.js';
import { matchingRules } from './engine/rules.js';
import { evaluateAssignment } from './engine/assignment.js';

const resolver = new Resolver();
const SHIFT_PREFIX = 'shift-group:';
const RULE_PREFIX = 'assignment-rule:';
const AUDIT_PREFIX = 'assignment-audit:';
const ROTATION_PREFIX = 'rotation:';

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

async function listShiftGroups() {
  return listByPrefix(SHIFT_PREFIX, 100);
}

async function describeUsers(accountIds = [], storedProfiles = []) {
  const stored = Object.fromEntries((storedProfiles || []).filter(p => p?.accountId).map(p => [p.accountId, p.displayName || p.accountId]));
  const unresolved = accountIds.filter(id => !stored[id]);
  const lookedUp = await Promise.all(unresolved.map(async accountId => {
    try {
      const response = await api.asUser().requestJira(route`/rest/api/3/user?accountId=${accountId}`);
      if (!response.ok) return [accountId, accountId];
      const user = await response.json();
      return [accountId, user.displayName || accountId];
    } catch {
      return [accountId, accountId];
    }
  }));
  return { ...stored, ...Object.fromEntries(lookedUp) };
}

function memberProfilesFromPayload(group = {}) {
  return [...new Map((group.memberProfiles || []).filter(p => p?.accountId).map(p => [p.accountId, {
    accountId: String(p.accountId),
    displayName: String(p.displayName || p.accountId)
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
    labels: fields.labels || [],
    componentIds: (fields.components || []).map(c => String(c.id)),
    fields
  };
}

async function getIssue(issueKey) {
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?expand=names`);
  if (!res.ok) throw new Error(`Unable to load ${issueKey} (${res.status})`);
  return res.json();
}

async function countOpenAssigned(accountIds = [], projectIds = []) {
  const entries = await Promise.all(accountIds.map(async accountId => {
    try {
      const projectClause = projectIds.length ? ` AND project in (${projectIds.join(',')})` : '';
      const jql = `assignee = "${accountId}" AND statusCategory != Done${projectClause}`;
      const res = await api.asUser().requestJira(route`/rest/api/3/search?jql=${jql}&maxResults=0`);
      if (!res.ok) return [accountId, 0];
      const body = await res.json();
      return [accountId, body.total || 0];
    } catch {
      return [accountId, 0];
    }
  }));
  return Object.fromEntries(entries);
}

async function audit(entry) {
  const createdAt = new Date().toISOString();
  const id = `${createdAt}:${Math.random().toString(36).slice(2)}`;
  await kvs.set(`${AUDIT_PREFIX}${id}`, { id, createdAt, ...entry });
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
    const persisted = JSON.stringify(memberProfiles) !== JSON.stringify(group.memberProfiles || []) ? { ...group, memberProfiles } : group;
    if (persisted !== group) await kvs.set(`${SHIFT_PREFIX}${group.id}`, persisted);
    enriched.push(enrichGroup(persisted, at));
  }
  const rules = (await listByPrefix(RULE_PREFIX, 100)).sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
  return {
    generatedAt: at.toISOString(),
    groups: enriched,
    rules,
    onShiftCount: enriched.reduce((sum, group) => sum + group.onShift.length, 0),
    enabledRuleCount: rules.filter(r => r.enabled).length
  };
});

resolver.define('getRoster', async ({ payload }) => {
  await assertAdmin();
  const startAt = new Date(payload?.startAt || Date.now());
  const days = Math.min(Math.max(Number(payload?.days || 7), 1), 31);
  const groups = await listShiftGroups();
  const slots = [];
  for (let d = 0; d < days; d += 1) {
    for (const hour of [0, 6, 9, 12, 15, 18, 21]) {
      const at = new Date(startAt);
      at.setUTCDate(startAt.getUTCDate() + d);
      at.setUTCHours(hour, 0, 0, 0);
      const people = [];
      for (const group of groups) {
        const enriched = enrichGroup(group, at);
        for (const user of enriched.onShift) people.push({ ...user, groupId: group.id, groupName: group.name });
      }
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
    shiftEndPolicy: String(raw.shiftEndPolicy || 'keep'),
    noAgentPolicy: String(raw.noAgentPolicy || 'leaveUnassigned'),
    slaThresholdMinutes: raw.slaThresholdMinutes == null ? null : Number(raw.slaThresholdMinutes),
    untouchedMinutes: raw.untouchedMinutes == null ? null : Number(raw.untouchedMinutes),
    updatedAt: new Date().toISOString(),
    createdAt: raw.createdAt || new Date().toISOString()
  };
  if (!rule.name) throw new Error('Rule name is required.');
  if (!rule.shiftGroupIds.length) throw new Error('Select at least one shift group.');
  await kvs.set(`${RULE_PREFIX}${id}`, rule);
  return rule;
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
  const jiraIssue = await getIssue(issueKey);
  const issue = toIssueModel(jiraIssue);
  const rules = await listByPrefix(RULE_PREFIX, 100);
  const matched = matchingRules({ rules, trigger, issue });
  if (!matched.length) return { issueKey, trigger, matchedRule: null, result: { action: 'none', reason: 'NO_MATCHING_RULE' }, eligible: [] };
  const rule = matched[0];
  const groups = (await listShiftGroups()).filter(g => rule.shiftGroupIds.includes(g.id));
  const at = new Date();
  const eligible = [...new Set(groups.flatMap(g => getOnShiftMembers({ shiftGroup: g, at, overrides: g.overrides || [] })))];
  const loads = await countOpenAssigned(eligible, rule.projectIds);
  const lastAssignedAccountId = await kvs.get(`${ROTATION_PREFIX}${rule.id}`);
  const result = evaluateAssignment({ rule, issue, eligibleAccountIds: eligible, loads, lastAssignedAccountId });
  const profiles = groups.flatMap(g => g.memberProfiles || []);
  const names = Object.fromEntries(profiles.map(p => [p.accountId, p.displayName]));
  return {
    issueKey,
    trigger,
    matchedRule: rule,
    result,
    eligible: eligible.map(accountId => ({ accountId, displayName: names[accountId] || accountId, load: loads[accountId] || 0 }))
  };
});

resolver.define('executeAssignment', async ({ payload }) => {
  await assertAdmin();
  const simulation = await resolver.getDefinitions().simulateAssignment?.({ payload });
  if (!simulation) throw new Error('Unable to evaluate assignment.');
  if (simulation.result?.action !== 'assign') return simulation;
  const issueKey = simulation.issueKey;
  const accountId = simulation.result.assigneeAccountId;
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/assignee`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId })
  });
  if (!res.ok) throw new Error(`Unable to assign ${issueKey} (${res.status})`);
  await kvs.set(`${ROTATION_PREFIX}${simulation.matchedRule.id}`, accountId);
  await audit({ issueKey, ruleId: simulation.matchedRule.id, ruleName: simulation.matchedRule.name, action: 'assign', assigneeAccountId: accountId, reason: simulation.result.reason, source: 'manual-execute' });
  return { ...simulation, executed: true };
});

resolver.define('getAuditLog', async () => {
  await assertAdmin();
  return (await listByPrefix(AUDIT_PREFIX, 100)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 100);
});

resolver.define('health', async () => ({ ok: true, version: '0.4.0', time: new Date().toISOString() }));

export const handler = resolver.getDefinitions();
