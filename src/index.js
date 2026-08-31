import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs, WhereConditions } from '@forge/kvs';
import { getOnShiftMembers } from './domain/shifts.js';
import { normaliseGroup } from './domain/shiftGroups.js';

const resolver = new Resolver();
const SHIFT_PREFIX = 'shift-group:';

async function assertAdmin() {
  const response = await api.asUser().requestJira(
    route`/rest/api/3/mypermissions?permissions=ADMINISTER`
  );
  if (!response.ok) {
    throw new Error(`Unable to verify Jira admin permission (${response.status})`);
  }
  const body = await response.json();
  if (!body?.permissions?.ADMINISTER?.havePermission) {
    throw new Error('Jira administrator permission is required.');
  }
}

async function listShiftGroups() {
  const result = await kvs.query()
    .where('key', WhereConditions.beginsWith(SHIFT_PREFIX))
    .limit(20)
    .getMany();
  return (result.results || []).map(item => item.value);
}

async function describeUsers(accountIds = []) {
  const entries = await Promise.all(accountIds.map(async accountId => {
    try {
      const response = await api.asUser().requestJira(
        route`/rest/api/3/user?accountId=${accountId}`
      );
      if (!response.ok) return [accountId, accountId];
      const user = await response.json();
      return [accountId, user.displayName || accountId];
    } catch {
      return [accountId, accountId];
    }
  }));
  return Object.fromEntries(entries);
}

resolver.define('getDashboard', async () => {
  await assertAdmin();
  const groups = await listShiftGroups();
  const at = new Date();
  const allIds = [...new Set(groups.flatMap(group => group.memberAccountIds || []))];
  const names = await describeUsers(allIds);
  const enriched = groups.map(group => {
    const onShiftIds = getOnShiftMembers({ shiftGroup: group, at, overrides: [] });
    return {
      ...group,
      onShift: onShiftIds.map(accountId => ({ accountId, displayName: names[accountId] || accountId })),
      memberCount: group.memberAccountIds?.length || 0
    };
  });
  return {
    generatedAt: at.toISOString(),
    groups: enriched,
    onShiftCount: enriched.reduce((sum, group) => sum + group.onShift.length, 0)
  };
});

resolver.define('saveShiftGroup', async ({ payload }) => {
  await assertAdmin();
  const group = normaliseGroup(payload?.group || {});
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

resolver.define('health', async () => ({
  ok: true,
  version: '0.2.1',
  time: new Date().toISOString()
}));

export const handler = resolver.getDefinitions();
