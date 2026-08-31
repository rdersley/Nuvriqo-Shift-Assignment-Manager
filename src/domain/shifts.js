const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];

function minutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time: ${hhmm}`);
  }
  return h * 60 + m;
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const obj = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    day: obj.weekday.toLowerCase().slice(0, 3),
    minuteOfDay: Number(obj.hour) * 60 + Number(obj.minute)
  };
}

function previousDay(day) {
  const i = DAY_KEYS.indexOf(day);
  return DAY_KEYS[(i + 6) % 7];
}

function scheduleMatches(schedule, day, minuteOfDay) {
  const start = minutes(schedule.start);
  const end = minutes(schedule.end);
  if (start === end) return false;
  if (end > start) {
    return schedule.day === day && minuteOfDay >= start && minuteOfDay < end;
  }
  return (schedule.day === day && minuteOfDay >= start) ||
    (schedule.day === previousDay(day) && minuteOfDay < end);
}

function overrideApplies(override, accountId, at) {
  if (override.accountId !== accountId) return false;
  const start = new Date(override.startAt);
  const end = new Date(override.endAt);
  return at >= start && at < end;
}

export function isMemberOnShift({ shiftGroup, accountId, at = new Date(), overrides = [] }) {
  if (!shiftGroup?.enabled || !shiftGroup.memberAccountIds?.includes(accountId)) return false;
  const activeOverrides = overrides.filter(o => overrideApplies(o, accountId, at));
  if (activeOverrides.some(o => o.type === 'exclude')) return false;
  if (activeOverrides.some(o => o.type === 'include')) return true;

  const { day, minuteOfDay } = localParts(at, shiftGroup.timezone || 'UTC');
  return (shiftGroup.recurringSchedule || []).some(s => scheduleMatches(s, day, minuteOfDay));
}

export function getOnShiftMembers({ shiftGroup, at = new Date(), overrides = [] }) {
  return (shiftGroup.memberAccountIds || []).filter(accountId =>
    isMemberOnShift({ shiftGroup, accountId, at, overrides })
  );
}
