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
  { label: 'Monday', value: 'mon' },
  { label: 'Tuesday', value: 'tue' },
  { label: 'Wednesday', value: 'wed' },
  { label: 'Thursday', value: 'thu' },
  { label: 'Friday', value: 'fri' },
  { label: 'Saturday', value: 'sat' },
  { label: 'Sunday', value: 'sun' }
];

const TIMEZONES = [
  { label: 'Dublin / London', value: 'Europe/Dublin' },
  { label: 'Central Europe', value: 'Europe/Paris' },
  { label: 'Eastern Europe', value: 'Europe/Athens' },
  { label: 'UTC', value: 'UTC' },
  { label: 'US Eastern', value: 'America/New_York' },
  { label: 'US Central', value: 'America/Chicago' },
  { label: 'US Pacific', value: 'America/Los_Angeles' }
];

function GroupCard({ group, onDelete }) {
  const schedule = group.recurringSchedule || [];
  const first = schedule[0];
  const days = schedule.map(item => item.day.toUpperCase()).join(', ');
  return (
    <Box xcss={{ borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius', padding: 'space.200' }}>
      <Stack space="space.100">
        <Inline spread="space-between" alignBlock="center">
          <Heading size="small">{group.name}</Heading>
          <Lozenge appearance={group.enabled ? 'success' : 'default'}>{group.enabled ? 'Enabled' : 'Disabled'}</Lozenge>
        </Inline>
        <Text>{group.timezone} · {days || 'No days'}{first ? ` · ${first.start}–${first.end}` : ''}</Text>
        <Text>{group.memberCount} member{group.memberCount === 1 ? '' : 's'}</Text>
        <Inline space="space.100" alignBlock="center">
          <Text as="strong">On shift now:</Text>
          {group.onShift?.length ? group.onShift.map(user => <Badge key={user.accountId}>{user.displayName}</Badge>) : <Lozenge appearance="moved">Nobody</Lozenge>}
        </Inline>
        <Button appearance="subtle" onClick={() => onDelete(group.id)}>Delete group</Button>
      </Stack>
    </Box>
  );
}

function App() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [name, setName] = useState('Service Desk');
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [days, setDays] = useState(DAY_OPTIONS.slice(0, 5));
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [members, setMembers] = useState([]);

  const selectedMemberIds = useMemo(() => (members || []).map(user => user.id || user.value).filter(Boolean), [members]);

  async function refresh() {
    setLoading(true);
    try {
      const data = await invoke('getDashboard');
      setDashboard(data);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to load Shift Manager.' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await invoke('saveShiftGroup', {
        group: {
          name,
          timezone: timezone?.value || 'Europe/Dublin',
          memberAccountIds: selectedMemberIds,
          schedule: {
            days: (days || []).map(day => day.value),
            start,
            end
          }
        }
      });
      setMessage({ type: 'success', text: 'Shift group saved. The On shift now view has been recalculated.' });
      await refresh();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to save the shift group.' });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    try {
      await invoke('deleteShiftGroup', { id });
      await refresh();
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to delete the shift group.' });
    }
  }

  return (
    <Stack space="space.300">
      <Stack space="space.100">
        <Inline spread="space-between" alignBlock="center">
          <Stack space="space.050">
            <Heading size="large">Shift & Assignment Manager</Heading>
            <Text>Define who is working now. Automatic ticket assignment rules will use these shifts in the next development slice.</Text>
          </Stack>
          <Button onClick={refresh}>Refresh</Button>
        </Inline>
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance="inprogress">Development build 0.2.0</Lozenge>
          <Text>{dashboard ? `${dashboard.onShiftCount} agent${dashboard.onShiftCount === 1 ? '' : 's'} currently on shift` : 'Loading current coverage…'}</Text>
        </Inline>
      </Stack>

      {message && <SectionMessage appearance={message.type === 'error' ? 'error' : 'success'}><Text>{message.text}</Text></SectionMessage>}

      <Box xcss={{ backgroundColor: 'color.background.neutral.subtle', borderRadius: 'border.radius', padding: 'space.300' }}>
        <Stack space="space.200">
          <Heading size="medium">Create a shift group</Heading>
          <Text>This first test build supports a recurring daily time window across selected weekdays, including overnight shifts.</Text>

          <Stack space="space.100">
            <Label labelFor="group-name">Shift group name</Label>
            <Textfield id="group-name" value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Service Desk Early Shift" />
          </Stack>

          <Stack space="space.100">
            <Label labelFor="timezone">Timezone</Label>
            <Select id="timezone" options={TIMEZONES} value={timezone} onChange={setTimezone} />
          </Stack>

          <Stack space="space.100">
            <Label labelFor="days">Working days</Label>
            <Select id="days" options={DAY_OPTIONS} value={days} onChange={setDays} isMulti isSearchable={false} />
          </Stack>

          <Inline space="space.200" alignBlock="end">
            <Stack space="space.100" grow="fill">
              <Label labelFor="start-time">Start time</Label>
              <Textfield id="start-time" value={start} onChange={event => setStart(event.target.value)} placeholder="09:00" />
            </Stack>
            <Stack space="space.100" grow="fill">
              <Label labelFor="end-time">End time</Label>
              <Textfield id="end-time" value={end} onChange={event => setEnd(event.target.value)} placeholder="17:00" />
            </Stack>
          </Inline>

          <Stack space="space.100">
            <UserPicker label="Shift members" name="shift-members" isMulti onChange={setMembers} placeholder="Select Jira users" />
            <Text>{selectedMemberIds.length} user{selectedMemberIds.length === 1 ? '' : 's'} selected</Text>
          </Stack>

          <ButtonGroup>
            <Button appearance="primary" isLoading={saving} onClick={save}>Save shift group</Button>
            <Button onClick={() => { setName('Service Desk'); setTimezone(TIMEZONES[0]); setDays(DAY_OPTIONS.slice(0, 5)); setStart('09:00'); setEnd('17:00'); setMembers([]); }}>Reset</Button>
          </ButtonGroup>
        </Stack>
      </Box>

      <Stack space="space.150">
        <Heading size="medium">Shift coverage</Heading>
        {loading && <Spinner size="medium" />}
        {!loading && !dashboard?.groups?.length && <SectionMessage appearance="information"><Text>No shift groups have been created yet. Create one above to start testing.</Text></SectionMessage>}
        {!loading && dashboard?.groups?.map(group => <GroupCard key={group.id} group={group} onDelete={remove} />)}
      </Stack>
    </Stack>
  );
}

ForgeReconciler.render(<App />);
