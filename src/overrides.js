import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';

const resolver = new Resolver();
const SHIFT_PREFIX = 'shift-group:';

async function assertAdmin() {
  const response = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`);
  if (!response.ok) throw new Error(`Unable to verify Jira admin permission (${response.status})`);
  const body = await response.json();
  if (!body?.permissions?.ADMINISTER?.havePermission) throw new Error('Jira administrator permission is required.');
}

async function listGroups() {
  const result = await kvs.query().where('key', WhereConditions.beginsWith(SHIFT_PREFIX)).limit(100).getMany();
  return (result.results || []).map(item => item.value);
}

resolver.define('getOverrideAdminData', async () => {
  await assertAdmin();
  const groups = await listGroups();
  return groups.map(group => ({
    id: group.id,
    name: group.name,
    timezone: group.timezone,
    members: (group.memberAccountIds || []).map(accountId => {
      const profile = (group.memberProfiles || []).find(p => p.accountId === accountId);
      return { accountId, displayName: profile?.displayName || accountId };
    }),
    overrides: (group.overrides || []).map(override => ({ ...override, groupId: group.id, groupName: group.name }))
  }));
});

resolver.define('saveShiftOverride', async ({ payload }) => {
  await assertAdmin();
  const groupId = String(payload?.groupId || '').trim();
  const accountId = String(payload?.accountId || '').trim();
  const type = payload?.type === 'exclude' ? 'exclude' : 'include';
  const startAt = new Date(payload?.startAt);
  const endAt = new Date(payload?.endAt);
  if (!groupId || !accountId) throw new Error('Shift group and member are required.');
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) throw new Error('Enter a valid override start and end time.');

  const key = `${SHIFT_PREFIX}${groupId}`;
  const group = await kvs.get(key);
  if (!group) throw new Error('Shift group not found.');
  if (!(group.memberAccountIds || []).includes(accountId)) throw new Error('Selected user is not a member of this shift group.');

  const profile = (group.memberProfiles || []).find(p => p.accountId === accountId);
  const override = {
    id: String(globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
    accountId,
    displayName: profile?.displayName || accountId,
    type,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    createdAt: new Date().toISOString()
  };
  await kvs.set(key, { ...group, overrides: [...(group.overrides || []), override] });
  return override;
});

resolver.define('deleteShiftOverride', async ({ payload }) => {
  await assertAdmin();
  const groupId = String(payload?.groupId || '').trim();
  const overrideId = String(payload?.overrideId || '').trim();
  if (!groupId || !overrideId) throw new Error('Shift group and override id are required.');
  const key = `${SHIFT_PREFIX}${groupId}`;
  const group = await kvs.get(key);
  if (!group) throw new Error('Shift group not found.');
  const overrides = (group.overrides || []).filter(override => override.id !== overrideId);
  await kvs.set(key, { ...group, overrides });
  return { ok: true };
});

export const handler = resolver.getDefinitions();
