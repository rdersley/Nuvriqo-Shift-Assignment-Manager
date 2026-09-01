import Resolver from '@forge/resolver';
import { kvs, WhereConditions } from '@forge/kvs';
import { getOnShiftMembers } from './domain/shifts.js';

const resolver = new Resolver();
const SHIFT_PREFIX = 'shift-group:';

async function listShiftGroups() {
  const result = await kvs.query().where('key', WhereConditions.beginsWith(SHIFT_PREFIX)).limit(100).getMany();
  return (result.results || []).map(item => item.value).filter(group => group?.enabled !== false);
}

function profileMap(group) {
  return Object.fromEntries((group.memberProfiles || []).map(profile => [profile.accountId, profile.displayName || profile.accountId]));
}

function enrich(group, at) {
  const names = profileMap(group);
  const ids = getOnShiftMembers({ shiftGroup: group, at, overrides: group.overrides || [] });
  return {
    id: group.id,
    name: group.name,
    timezone: group.timezone,
    recurringSchedule: group.recurringSchedule || [],
    members: (group.memberAccountIds || []).map(accountId => ({ accountId, displayName: names[accountId] || accountId })),
    onShift: ids.map(accountId => ({ accountId, displayName: names[accountId] || accountId }))
  };
}

resolver.define('getPublicSchedule', async ({ payload }) => {
  const startAt = new Date(payload?.startAt || Date.now());
  if (Number.isNaN(startAt.getTime())) throw new Error('Invalid schedule start date.');
  const days = Math.min(Math.max(Number(payload?.days || 7), 1), 31);
  const groups = await listShiftGroups();
  const now = new Date();
  const currentGroups = groups.map(group => enrich(group, now));
  const slots = [];

  for (let day = 0; day < days; day += 1) {
    for (const hour of [0, 6, 9, 12, 15, 18, 21]) {
      const at = new Date(startAt);
      at.setUTCDate(startAt.getUTCDate() + day);
      at.setUTCHours(hour, 0, 0, 0);
      const people = groups.flatMap(group => {
        const enriched = enrich(group, at);
        return enriched.onShift.map(user => ({ ...user, groupId: group.id, groupName: group.name }));
      });
      slots.push({ at: at.toISOString(), people });
    }
  }

  return {
    generatedAt: now.toISOString(),
    onShiftCount: currentGroups.reduce((total, group) => total + group.onShift.length, 0),
    groups: currentGroups,
    startAt: startAt.toISOString(),
    days,
    slots
  };
});

export const handler = resolver.getDefinitions();
