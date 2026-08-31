const VALID_DAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `shift-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normaliseSchedule(input = {}) {
  const days = [...new Set((input.days || []).filter(day => VALID_DAYS.has(day)))];
  const start = String(input.start || '09:00');
  const end = String(input.end || '17:00');
  if (!TIME_RE.test(start)) throw new Error('Start time must be HH:mm.');
  if (!TIME_RE.test(end)) throw new Error('End time must be HH:mm.');
  return days.map(day => ({ day, start, end }));
}

export function normaliseGroup(input = {}, now = new Date()) {
  const id = input.id || makeId();
  const memberAccountIds = [...new Set((input.memberAccountIds || []).map(String).map(v => v.trim()).filter(Boolean))];
  const stamp = now.toISOString();
  const name = String(input.name || '').trim();
  const timezone = String(input.timezone || 'Europe/Dublin').trim();
  const recurringSchedule = normaliseSchedule(input.schedule || {
    days: (input.recurringSchedule || []).map(item => item.day),
    start: input.recurringSchedule?.[0]?.start,
    end: input.recurringSchedule?.[0]?.end
  });

  if (!name) throw new Error('Shift group name is required.');
  if (!memberAccountIds.length) throw new Error('Select at least one Jira user.');
  if (!recurringSchedule.length) throw new Error('Select at least one working day.');

  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(now);
  } catch {
    throw new Error('A valid IANA timezone is required.');
  }

  return {
    id,
    name,
    timezone,
    enabled: input.enabled !== false,
    memberAccountIds,
    recurringSchedule,
    createdAt: input.createdAt || stamp,
    updatedAt: stamp
  };
}
