import test from 'node:test';
import assert from 'node:assert/strict';
import { isMemberOnShift, getOnShiftMembers } from '../src/domain/shifts.js';

const group = {
  enabled: true,
  timezone: 'Europe/Dublin',
  memberAccountIds: ['a','b'],
  recurringSchedule: [{ day: 'mon', start: '08:00', end: '16:00' }]
};

test('member is eligible during recurring shift', () => {
  assert.equal(isMemberOnShift({ shiftGroup: group, accountId: 'a', at: new Date('2026-08-31T09:00:00Z') }), true);
});

test('exclude override wins over recurring shift', () => {
  const overrides = [{ accountId: 'a', type: 'exclude', startAt: '2026-08-31T08:00:00Z', endAt: '2026-08-31T12:00:00Z' }];
  assert.equal(isMemberOnShift({ shiftGroup: group, accountId: 'a', at: new Date('2026-08-31T09:00:00Z'), overrides }), false);
});

test('returns on-shift members only', () => {
  assert.deepEqual(getOnShiftMembers({ shiftGroup: group, at: new Date('2026-08-31T09:00:00Z') }), ['a','b']);
});

test('overnight schedule carries into next day', () => {
  const overnight = { ...group, timezone: 'UTC', recurringSchedule: [{ day: 'mon', start: '23:00', end: '07:00' }] };
  assert.equal(isMemberOnShift({ shiftGroup: overnight, accountId: 'a', at: new Date('2026-09-01T02:00:00Z') }), true);
});
