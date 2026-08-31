import React, { useEffect, useMemo, useState } from 'react';
import ForgeReconciler, {
  Badge,
  Box,
  Button,
  ButtonGroup,
  Heading,
  Inline,
  Label,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  UserPicker
} from '@forge/react';
import { invoke } from '@forge/bridge';

const DAY_OPTIONS = [
  { label: 'Monday', value: 'mon' }, { label: 'Tuesday', value: 'tue' }, { label: 'Wednesday', value: 'wed' },
  { label: 'Thursday', value: 'thu' }, { label: 'Friday', value: 'fri' }, { label: 'Saturday', value: 'sat' }, { label: 'Sunday', value: 'sun' }
];
const TIMEZONES = [
  { label: 'Dublin / London', value: 'Europe/Dublin' }, { label: 'Central Europe', value: 'Europe/Paris' },
  { label: 'Eastern Europe', value: 'Europe/Athens' }, { label: 'UTC', value: 'UTC' },
  { label: 'US Eastern', value: 'America/New_York' }, { label: 'US Central', value: 'America/Chicago' }, { label: 'US Pacific', value: 'America/Los_Angeles' }
];
const TRIGGERS = [
  { label: 'Issue created', value: 'issueCreated' }, { label: 'Issue becomes unassigned', value: 'unassigned' },
  { label: 'Status changed', value: 'statusChanged' }, { label: 'Customer replied', value: 'customerReply' },
  { label: 'Priority changed / P1-P2', value: 'priorityChanged' }, { label: 'SLA threshold reached', value: 'slaThreshold' },
  { label: 'Issue untouched for a period', value: 'untouched' }, { label: 'Shift starts', value: 'shiftStart' }, { label: 'Shift ends', value: 'shiftEnd' }
];
const STRATEGIES = [
  { label: 'Round robin', value: 'roundRobin' }, { label: 'Least loaded', value: 'leastLoaded' },
  { label: 'Fixed preferred order', value: 'fixedOrder' }, { label: 'Random', value: 'random' }
];
const YES_NO = [{ label: 'No', value: 'no' }, { label: 'Yes', value: 'yes' }];
const VIEWS = ['Dashboard', 'Schedule', 'Assignment Rules', 'Simulator', 'Audit Log'];

const cardXcss = { borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius', padding: 'space.200' };

function GroupCard({ group, onDelete }) {
  const schedule = group.recurringSchedule || [];
  const first = schedule[0];
  const days = schedule.map(item => item.day.toUpperCase()).join(', ');
  return <Box xcss={cardXcss}><Stack space="space.100">
    <Inline spread="space-between" alignBlock="center"><Heading size="small">{group.name}</Heading><Lozenge appearance={group.enabled ? 'success' : 'default'}>{group.enabled ? 'Enabled' : 'Disabled'}</Lozenge></Inline>
    <Text>{group.timezone} · {days || 'No days'}{first ? ` · ${first.start}–${first.end}` : ''}</Text>
    <Inline space="space.100"><Text as="strong">Members:</Text>{group.members?.map(user => <Badge key={user.accountId}>{user.displayName}</Badge>)}</Inline>
    <Inline space="space.100"><Text as="strong">On shift now:</Text>{group.onShift?.length ? group.onShift.map(user => <Badge key={user.accountId}>{user.displayName}</Badge>) : <Lozenge appearance="moved">Nobody</Lozenge>}</Inline>
    <Button appearance="subtle" onClick={() => onDelete(group.id)}>Delete group</Button>
  </Stack></Box>;
}

function App() {
  const [view, setView] = useState('Dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('Service Desk');
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [days, setDays] = useState(DAY_OPTIONS.slice(0, 5));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [members, setMembers] = useState([]);
  const [roster, setRoster] = useState(null);
  const [rosterDays, setRosterDays] = useState(7);
  const [ruleName, setRuleName] = useState('New ticket assignment');
  const [rulePriority, setRulePriority] = useState('100');
  const [ruleTrigger, setRuleTrigger] = useState(TRIGGERS[0]);
  const [ruleStrategy, setRuleStrategy] = useState(STRATEGIES[0]);
  const [ruleGroups, setRuleGroups] = useState([]);
  const [projectIds, setProjectIds] = useState('');
  const [statusId, setStatusId] = useState('');
  const [priorityId, setPriorityId] = useState('');
  const [forceReassign, setForceReassign] = useState(YES_NO[0]);
  const [slaMinutes, setSlaMinutes] = useState('30');
  const [untouchedMinutes, setUntouchedMinutes] = useState('60');
  const [issueKey, setIssueKey] = useState('');
  const [simulationTrigger, setSimulationTrigger] = useState(TRIGGERS[0]);
  const [simulation, setSimulation] = useState(null);
  const [audit, setAudit] = useState([]);

  const selectedMemberIds = useMemo(() => (members || []).map(user => user.id || user.value).filter(Boolean), [members]);
  const selectedMemberProfiles = useMemo(() => (members || []).map(user => ({ accountId: user.id || user.value, displayName: user.name || user.label || user.displayName || user.id || user.value })).filter(p => p.accountId), [members]);
  const groupOptions = useMemo(() => (dashboard?.groups || []).map(g => ({ label: g.name, value: g.id })), [dashboard]);

  async function refresh() {
    setLoading(true);
    try { setDashboard(await invoke('getDashboard')); setMessage(null); }
    catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to load Shift Manager.' }); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function saveShift() {
    setSaving(true); setMessage(null);
    try {
      await invoke('saveShiftGroup', { group: { name, timezone: timezone?.value || 'Europe/Dublin', memberAccountIds: selectedMemberIds, memberProfiles: selectedMemberProfiles, schedule: { days: (days || []).map(d => d.value), start, end } } });
      setMessage({ type: 'success', text: 'Shift group saved.' }); await refresh();
    } catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to save shift group.' }); }
    finally { setSaving(false); }
  }
  async function removeShift(id) { try { await invoke('deleteShiftGroup', { id }); await refresh(); } catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to delete shift group.' }); } }

  async function loadRoster(daysCount = rosterDays) {
    setRosterDays(daysCount);
    try {
      const now = new Date(); now.setUTCHours(0, 0, 0, 0);
      setRoster(await invoke('getRoster', { startAt: now.toISOString(), days: daysCount }));
    } catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to load roster.' }); }
  }

  async function saveRule() {
    const conditions = [];
    if (statusId.trim()) conditions.push({ field: 'statusId', operator: 'equals', value: statusId.trim() });
    if (priorityId.trim()) conditions.push({ field: 'priorityId', operator: 'equals', value: priorityId.trim() });
    try {
      await invoke('saveAssignmentRule', { rule: {
        name: ruleName, priority: Number(rulePriority || 100), trigger: ruleTrigger.value,
        assignmentStrategy: ruleStrategy.value, shiftGroupIds: (ruleGroups || []).map(g => g.value),
        projectIds: projectIds.split(',').map(v => v.trim()).filter(Boolean), conditions,
        forceReassign: forceReassign.value === 'yes', slaThresholdMinutes: Number(slaMinutes || 0), untouchedMinutes: Number(untouchedMinutes || 0)
      } });
      setMessage({ type: 'success', text: 'Assignment rule saved.' }); await refresh();
    } catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to save assignment rule.' }); }
  }
  async function removeRule(id) { try { await invoke('deleteAssignmentRule', { id }); await refresh(); } catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to delete rule.' }); } }

  async function simulate(execute = false) {
    setSimulation(null);
    try { setSimulation(await invoke(execute ? 'executeAssignment' : 'simulateAssignment', { issueKey, trigger: simulationTrigger.value })); if (execute) await loadAudit(); }
    catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to simulate assignment.' }); }
  }
  async function loadAudit() { try { setAudit(await invoke('getAuditLog')); } catch (error) { setMessage({ type: 'error', text: error?.message || 'Unable to load audit log.' }); } }

  function Nav() { return <ButtonGroup>{VIEWS.map(v => <Button key={v} appearance={view === v ? 'primary' : 'default'} onClick={() => { setView(v); if (v === 'Schedule') loadRoster(7); if (v === 'Audit Log') loadAudit(); }}>{v}</Button>)}</ButtonGroup>; }

  return <Stack space="space.300">
    <Inline spread="space-between" alignBlock="center"><Stack space="space.050"><Heading size="large">Shift & Assignment Manager</Heading><Text>Schedule coverage, route work to agents on shift, test rules safely and keep a full audit trail.</Text></Stack><Button onClick={refresh}>Refresh</Button></Inline>
    <Inline space="space.100"><Lozenge appearance="inprogress">Development build 0.4.0</Lozenge><Text>{dashboard ? `${dashboard.onShiftCount} on shift · ${dashboard.enabledRuleCount} active rules` : 'Loading…'}</Text></Inline>
    <Nav />
    {message && <SectionMessage appearance={message.type === 'error' ? 'error' : 'success'}><Text>{message.text}</Text></SectionMessage>}

    {view === 'Dashboard' && <Stack space="space.200">
      <Inline space="space.200"><Box xcss={cardXcss}><Heading size="small">On shift now</Heading><Text>{dashboard?.onShiftCount || 0} agents currently available</Text></Box><Box xcss={cardXcss}><Heading size="small">Assignment rules</Heading><Text>{dashboard?.enabledRuleCount || 0} enabled</Text></Box><Box xcss={cardXcss}><Heading size="small">Shift groups</Heading><Text>{dashboard?.groups?.length || 0} configured</Text></Box></Inline>
      <Heading size="medium">Current coverage</Heading>
      {loading ? <Spinner size="medium" /> : dashboard?.groups?.map(g => <GroupCard key={g.id} group={g} onDelete={removeShift} />)}
    </Stack>}

    {view === 'Schedule' && <Stack space="space.250">
      <Inline spread="space-between"><Heading size="medium">Roster & coverage</Heading><ButtonGroup><Button appearance={rosterDays === 1 ? 'primary' : 'default'} onClick={() => loadRoster(1)}>Day</Button><Button appearance={rosterDays === 7 ? 'primary' : 'default'} onClick={() => loadRoster(7)}>Week</Button><Button appearance={rosterDays === 31 ? 'primary' : 'default'} onClick={() => loadRoster(31)}>Month</Button></ButtonGroup></Inline>
      <SectionMessage appearance="information"><Text>Coverage snapshots show 00:00, 06:00, 09:00, 12:00, 15:00, 18:00 and 21:00. Empty periods are highlighted as no assignment coverage.</Text></SectionMessage>
      {!roster && <Spinner size="medium" />}
      {roster?.slots?.map(slot => <Box key={slot.at} xcss={cardXcss}><Inline spread="space-between"><Text as="strong">{new Date(slot.at).toLocaleString()}</Text>{slot.people.length ? <Inline space="space.050">{slot.people.map((p, i) => <Badge key={`${p.accountId}-${i}`}>{p.displayName} · {p.groupName}</Badge>)}</Inline> : <Lozenge appearance="moved">No assignment coverage</Lozenge>}</Inline></Box>)}
      <Box xcss={{ backgroundColor: 'color.background.neutral.subtle', padding: 'space.300', borderRadius: 'border.radius' }}><Stack space="space.150"><Heading size="medium">Create a shift group</Heading><Label labelFor="group-name">Shift group name</Label><Textfield id="group-name" value={name} onChange={e => setName(e.target.value)} /><Label labelFor="timezone">Timezone</Label><Select id="timezone" options={TIMEZONES} value={timezone} onChange={setTimezone} /><Label labelFor="days">Working days</Label><Select id="days" options={DAY_OPTIONS} value={days} onChange={setDays} isMulti /><Inline space="space.200"><Stack grow="fill"><Label labelFor="start-time">Start time</Label><Textfield id="start-time" value={start} onChange={e => setStart(e.target.value)} /></Stack><Stack grow="fill"><Label labelFor="end-time">End time</Label><Textfield id="end-time" value={end} onChange={e => setEnd(e.target.value)} /></Stack></Inline><UserPicker label="Shift members" name="shift-members" isMulti onChange={setMembers} placeholder="Select Jira users" /><Button appearance="primary" isLoading={saving} onClick={saveShift}>Save shift group</Button></Stack></Box>
    </Stack>}

    {view === 'Assignment Rules' && <Stack space="space.250">
      <Box xcss={{ backgroundColor: 'color.background.neutral.subtle', padding: 'space.300', borderRadius: 'border.radius' }}><Stack space="space.150"><Heading size="medium">Create assignment rule</Heading><Label labelFor="rule-name">Rule name</Label><Textfield id="rule-name" value={ruleName} onChange={e => setRuleName(e.target.value)} /><Inline space="space.200"><Stack grow="fill"><Label labelFor="rule-priority">Rule priority</Label><Textfield id="rule-priority" value={rulePriority} onChange={e => setRulePriority(e.target.value)} /></Stack><Stack grow="fill"><Label labelFor="trigger">Trigger</Label><Select id="trigger" options={TRIGGERS} value={ruleTrigger} onChange={setRuleTrigger} /></Stack></Inline><Label labelFor="groups">Eligible shift groups</Label><Select id="groups" options={groupOptions} value={ruleGroups} onChange={setRuleGroups} isMulti /><Label labelFor="strategy">Assignment strategy</Label><Select id="strategy" options={STRATEGIES} value={ruleStrategy} onChange={setRuleStrategy} /><Label labelFor="projects">Project IDs (optional, comma separated)</Label><Textfield id="projects" value={projectIds} onChange={e => setProjectIds(e.target.value)} /><Inline space="space.200"><Stack grow="fill"><Label labelFor="status">Status ID condition</Label><Textfield id="status" value={statusId} onChange={e => setStatusId(e.target.value)} /></Stack><Stack grow="fill"><Label labelFor="priority">Priority ID condition</Label><Textfield id="priority" value={priorityId} onChange={e => setPriorityId(e.target.value)} /></Stack></Inline><Inline space="space.200"><Stack grow="fill"><Label labelFor="sla">SLA threshold minutes</Label><Textfield id="sla" value={slaMinutes} onChange={e => setSlaMinutes(e.target.value)} /></Stack><Stack grow="fill"><Label labelFor="untouched">Untouched minutes</Label><Textfield id="untouched" value={untouchedMinutes} onChange={e => setUntouchedMinutes(e.target.value)} /></Stack></Inline><Label labelFor="force">Force reassignment if current owner is on shift?</Label><Select id="force" options={YES_NO} value={forceReassign} onChange={setForceReassign} /><Button appearance="primary" onClick={saveRule}>Save assignment rule</Button></Stack></Box>
      <Heading size="medium">Configured rules</Heading>
      {!dashboard?.rules?.length && <SectionMessage appearance="information"><Text>No assignment rules configured yet.</Text></SectionMessage>}
      {dashboard?.rules?.map(rule => <Box key={rule.id} xcss={cardXcss}><Stack space="space.100"><Inline spread="space-between"><Heading size="small">{rule.priority}. {rule.name}</Heading><Lozenge appearance={rule.enabled ? 'success' : 'default'}>{rule.enabled ? 'Enabled' : 'Disabled'}</Lozenge></Inline><Text>{TRIGGERS.find(t => t.value === rule.trigger)?.label || rule.trigger} · {STRATEGIES.find(s => s.value === rule.assignmentStrategy)?.label || rule.assignmentStrategy}</Text><Text>{rule.shiftGroupIds.length} shift group(s) · {rule.projectIds.length ? `Projects ${rule.projectIds.join(', ')}` : 'All projects'}</Text><Button appearance="subtle" onClick={() => removeRule(rule.id)}>Delete rule</Button></Stack></Box>)}
    </Stack>}

    {view === 'Simulator' && <Stack space="space.200"><Heading size="medium">Rule simulator</Heading><Text>Test which rule and agent would win without changing Jira. Use Execute only when you deliberately want to apply the simulated assignment.</Text><Label labelFor="issue-key">Jira issue key</Label><Textfield id="issue-key" value={issueKey} onChange={e => setIssueKey(e.target.value)} placeholder="TEST-123" /><Label labelFor="sim-trigger">Trigger to simulate</Label><Select id="sim-trigger" options={TRIGGERS} value={simulationTrigger} onChange={setSimulationTrigger} /><ButtonGroup><Button appearance="primary" onClick={() => simulate(false)}>Simulate only</Button><Button appearance="warning" onClick={() => simulate(true)}>Execute result</Button></ButtonGroup>{simulation && <Box xcss={cardXcss}><Stack space="space.100"><Heading size="small">Simulation result</Heading><Text>Matched rule: {simulation.matchedRule?.name || 'None'}</Text><Text>Action: {simulation.result?.action} · {simulation.result?.reason}</Text>{simulation.result?.assigneeAccountId && <Text>Selected agent: {simulation.eligible?.find(u => u.accountId === simulation.result.assigneeAccountId)?.displayName || simulation.result.assigneeAccountId}</Text>}<Text>Eligible agents: {simulation.eligible?.length || 0}</Text>{simulation.eligible?.map(u => <Badge key={u.accountId}>{u.displayName} · {u.load} open</Badge>)}</Stack></Box>}</Stack>}

    {view === 'Audit Log' && <Stack space="space.200"><Inline spread="space-between"><Heading size="medium">Assignment audit log</Heading><Button onClick={loadAudit}>Refresh audit</Button></Inline>{!audit.length && <SectionMessage appearance="information"><Text>No assignment actions have been recorded yet.</Text></SectionMessage>}{audit.map(item => <Box key={item.id} xcss={cardXcss}><Text as="strong">{item.issueKey} · {item.action}</Text><Text>{item.ruleName} · {item.reason}</Text><Text>{new Date(item.createdAt).toLocaleString()} · {item.source}</Text></Box>)}</Stack>}
  </Stack>;
}

ForgeReconciler.render(<App />);
