import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Badge, Box, Button, ButtonGroup, Heading, Inline, Lozenge, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

const cardXcss = { borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius', padding: 'space.200' };

function App() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function load(daysToLoad = days) {
    setDays(daysToLoad);
    setLoading(true);
    setError(null);
    try {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      setData(await invoke('getPublicSchedule', { startAt: start.toISOString(), days: daysToLoad }));
    } catch (e) {
      setError(e?.message || 'Unable to load the shift schedule.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(7); }, []);

  return <Stack space="space.300">
    <Inline spread="space-between" alignBlock="center">
      <Stack space="space.050"><Heading size="large">Shift Schedule</Heading><Text>See who is working now and upcoming service-desk coverage.</Text></Stack>
      <Button onClick={() => load(days)}>Refresh</Button>
    </Inline>

    {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
    <Inline space="space.200">
      <Box xcss={cardXcss}><Heading size="small">On shift now</Heading><Text>{data?.onShiftCount || 0} agent(s)</Text></Box>
      <Box xcss={cardXcss}><Heading size="small">Shift groups</Heading><Text>{data?.groups?.length || 0} active</Text></Box>
    </Inline>

    <Heading size="medium">Current teams</Heading>
    {loading && !data ? <Spinner size="medium" /> : data?.groups?.map(group => <Box key={group.id} xcss={cardXcss}><Stack space="space.100">
      <Inline spread="space-between"><Heading size="small">{group.name}</Heading><Text>{group.timezone}</Text></Inline>
      <Inline space="space.100"><Text as="strong">On shift:</Text>{group.onShift?.length ? group.onShift.map(user => <Badge key={user.accountId}>{user.displayName}</Badge>) : <Lozenge appearance="moved">Nobody</Lozenge>}</Inline>
      <Inline space="space.100"><Text as="strong">Team:</Text>{group.members?.map(user => <Badge key={user.accountId}>{user.displayName}</Badge>)}</Inline>
    </Stack></Box>)}

    <Inline spread="space-between" alignBlock="center"><Heading size="medium">Coverage</Heading><ButtonGroup><Button appearance={days === 1 ? 'primary' : 'default'} onClick={() => load(1)}>Day</Button><Button appearance={days === 7 ? 'primary' : 'default'} onClick={() => load(7)}>Week</Button><Button appearance={days === 31 ? 'primary' : 'default'} onClick={() => load(31)}>Month</Button></ButtonGroup></Inline>
    {loading ? <Spinner size="medium" /> : data?.slots?.map(slot => <Box key={slot.at} xcss={cardXcss}><Inline spread="space-between"><Text as="strong">{new Date(slot.at).toLocaleString()}</Text>{slot.people?.length ? <Inline space="space.050">{slot.people.map((person, index) => <Badge key={`${person.accountId}-${index}`}>{person.displayName} · {person.groupName}</Badge>)}</Inline> : <Lozenge appearance="moved">No coverage</Lozenge>}</Inline></Box>)}
  </Stack>;
}

ForgeReconciler.render(<App />);
