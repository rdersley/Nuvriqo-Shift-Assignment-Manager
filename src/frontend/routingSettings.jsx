import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, Heading, Inline, Label, Lozenge, SectionMessage, Spinner, Stack, Text, Textfield } from '@forge/react';
import { invoke } from '@forge/bridge';

function App() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState(null);

  async function refresh() {
    setLoading(true);
    try {
      const settings = await invoke('getRoutingSettings');
      setEnabled(settings?.automaticRoutingEnabled === true);
      setMessage(null);
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to load routing settings.' });
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh(); }, []);

  async function setRouting(next) {
    if (next && confirm.trim().toUpperCase() !== 'ENABLE') {
      setMessage({ type: 'error', text: 'Type ENABLE before turning on automatic routing.' });
      return;
    }
    setLoading(true);
    try {
      const settings = await invoke('setAutomaticRouting', { enabled: next });
      setEnabled(settings?.automaticRoutingEnabled === true);
      setConfirm('');
      setMessage({ type: 'success', text: next ? 'Automatic routing enabled.' : 'Automatic routing disabled.' });
    } catch (error) {
      setMessage({ type: 'error', text: error?.message || 'Unable to update routing settings.' });
    } finally { setLoading(false); }
  }

  return <Stack space="space.300">
    <Stack space="space.050"><Heading size="large">Automatic Routing Safety</Heading><Text>Global safety control for Shift & Assignment Manager background assignment.</Text></Stack>
    {message && <SectionMessage appearance={message.type === 'error' ? 'error' : 'success'}><Text>{message.text}</Text></SectionMessage>}
    {loading ? <Spinner size="medium" /> : <Box xcss={{ padding: 'space.300', borderWidth: 'border.width', borderStyle: 'solid', borderColor: 'color.border', borderRadius: 'border.radius' }}><Stack space="space.200">
      <Inline spread="space-between" alignBlock="center"><Stack space="space.050"><Heading size="medium">Background routing</Heading><Text>Issue events, SLA checks, untouched-ticket checks and shift-boundary routing.</Text></Stack><Lozenge appearance={enabled ? 'success' : 'default'}>{enabled ? 'ON' : 'OFF'}</Lozenge></Inline>
      {!enabled && <SectionMessage appearance="information"><Text>Safe mode is active. Rules and the simulator can be configured, but background events cannot reassign tickets.</Text></SectionMessage>}
      {enabled && <SectionMessage appearance="warning"><Text>Automatic routing is live. Enabled assignment rules can change Jira assignees without manual confirmation.</Text></SectionMessage>}
      {!enabled && <Stack space="space.100"><Label labelFor="enable-confirm">To enable, type ENABLE</Label><Textfield id="enable-confirm" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="ENABLE"/><Button appearance="primary" isDisabled={confirm.trim().toUpperCase() !== 'ENABLE'} onClick={() => setRouting(true)}>Enable automatic routing</Button></Stack>}
      {enabled && <Button appearance="danger" onClick={() => setRouting(false)}>Disable automatic routing</Button>}
    </Stack></Box>}
  </Stack>;
}

ForgeReconciler.render(<App />);
