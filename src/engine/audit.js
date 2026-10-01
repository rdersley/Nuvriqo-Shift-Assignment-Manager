// Audit keys sort newest-first: KVS returns keys in ascending order, so the timestamp is inverted.
export const AUDIT_PREFIX = 'assignment-audit-v2:';
// Pre-0.9 keys used an ascending ISO timestamp, so a 100-item query returned the oldest entries.
export const LEGACY_AUDIT_PREFIX = 'assignment-audit:';

const MAX_TIME = 9_999_999_999_999;

export function auditKey(now = new Date(), suffix = Math.random().toString(36).slice(2, 10)) {
  return `${AUDIT_PREFIX}${String(MAX_TIME - now.getTime()).padStart(13, '0')}:${suffix}`;
}

export function newestFirst(entries = [], limit = 100) {
  return [...entries].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
}
