import React, { useEffect, useMemo, useState } from 'react';
import ForgeReconciler, { Box, Button, Heading, Inline, Label, Lozenge, SectionMessage, Select, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke } from '@forge/bridge';

const TYPES = [
  { label: 'Temporary cover / include on shift', value: 'include' },
  { label: 'Temporary absence / exclude from shift', value: 'exclude' }
];

function App() {
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState(null);
  const [member, setMember] = useState(null);
  const [type, setType] = useState(TYPES[0]);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const groupOptions = useMemo(() => groups.map(g => ({ label: `${g.name} · ${g.timezone}`, value: g.id })), [groups]);
  const selectedGroup = useMemo(() => groups.find(g => g.id === group?.value), [groups, group]);
  const memberOptions = useMemo(() => (selectedGroup?.members || []).map(m => ({ label: m.displayName, value: m.accountId })), [selectedGroup]);
  const overrides = useMemo(() => groups.flatMap(g => (g.overrides || []).map(o => ({ ...o, groupId: g.id, groupName: g.name }))).sort((a,b) => String(a.startAt).localeCompare(String(b.startAt))), [groups]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await invoke('getOverrideAdminData');
      setGroups(data || []);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to load shift exceptions.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    if (!group || !member || !startAt || !endAt) {
      setMessage({ type: 'error', text: 'Choose a group, member, start time and end time.' });
      return;
    }
    try {
      await invoke('saveShiftOverride', { groupId: group.value, accountId: member.value, type: type.value, startAt, endAt });
      setMessage({ type: 'success', text: 'Shift exception saved.' });
      await refresh();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to save shift exception.' });
    }
  }

  async function remove(groupId, overrideId) {
    try {
      await invoke('deleteShiftOverride', { groupId, overrideId });
      await refresh();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to delete shift exception.' });
    }
  }

  return <Stack space="space.300">
    <Stack space="space.050"><Heading size="large">Shift Cover & Exceptions</Heading><Text>Temporary cover and absence windows override the recurring rota without changing the base schedule.</Text></Stack>
    {message && <SectionMessage appearance={message.type === 'error' ? 'error' : 'success'}><Text>{message.text}</Text></SectionMessage>}
    {loading ? <Spinner size="medium" /> : <>
      <Box xcss={{ padding: 'space.300', borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius' }}>
        <Stack space="space.150">
          <Heading size="medium">Add an exception</Heading>
          <Label labelFor="group">Shift group</Label><Select id="group" options={groupOptions} value={group} onChange={value => { setGroup(value); setMember(null); }} />
          <Label labelFor="member">Member</Label><Select id="member" options={memberOptions} value={member} onChange={setMember} isDisabled={!group} />
          <Label labelFor="type">Exception type</Label><Select id="type" options={TYPES} value={type} onChange={setType} />
          <Inline space="space.200">
            <Stack grow="fill"><Label labelFor="start">Starts</Label><Textfield id="start" value={startAt} onChange={e => setStartAt(e.target.value)} placeholder="2026-09-01T17:00:00+01:00" /></Stack>
            <Stack grow="fill"><Label labelFor="end">Ends</Label><Textfield id="end" value={endAt} onChange={e => setEndAt(e.target.value)} placeholder="2026-09-01T23:00:00+01:00" /></Stack>
          </Inline>
          <Text>Use an ISO date/time including the offset, for example 2026-09-01T17:00:00+01:00.</Text>
          <Button appearance="primary" onClick={save}>Save exception</Button>
        </Stack>
      </Box>

      <Heading size="medium">Current exceptions</Heading>
      {!overrides.length && <SectionMessage appearance="information"><Text>No cover or absence exceptions are configured.</Text></SectionMessage>}
      {overrides.map(o => <Box key={o.id} xcss={{ padding: 'space.200', borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius' }}>
        <Inline spread="space-between" alignBlock="center">
          <Stack space="space.050">
            <Inline space="space.100"><Text as="strong">{o.displayName || o.accountId}</Text><Lozenge appearance={o.type === 'include' ? 'success' : 'moved'}>{o.type === 'include' ? 'Cover' : 'Absent'}</Lozenge></Inline>
            <Text>{o.groupName} · {new Date(o.startAt).toLocaleString()} → {new Date(o.endAt).toLocaleString()}</Text>
          </Stack>
          <Button appearance="subtle" onClick={() => remove(o.groupId, o.id)}>Delete</Button>
        </Inline>
      </Box>)}
    </>}
  </Stack>;
}

ForgeReconciler.render(<App />);
