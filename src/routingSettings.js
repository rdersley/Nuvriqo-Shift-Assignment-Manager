import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';

export const ROUTING_SETTINGS_KEY = 'settings:automatic-routing';

const resolver = new Resolver();

async function assertAdmin() {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!response.ok) throw new Error(`Unable to verify Jira admin permission (${response.status})`);
  const body = await response.json();
  if (!body?.permissions?.ADMINISTER?.havePermission) throw new Error('Jira administrator permission is required.');
}

export async function getAutomaticRoutingEnabled() {
  const value = await kvs.get(ROUTING_SETTINGS_KEY);
  return value === true;
}

resolver.define('getRoutingSettings', async () => {
  await assertAdmin();
  return { automaticRoutingEnabled: await getAutomaticRoutingEnabled() };
});

resolver.define('setAutomaticRouting', async ({ payload }) => {
  await assertAdmin();
  const enabled = payload?.enabled === true;
  await kvs.set(ROUTING_SETTINGS_KEY, enabled);
  return { automaticRoutingEnabled: enabled };
});

export const handler = resolver.getDefinitions();
