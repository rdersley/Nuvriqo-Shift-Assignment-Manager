import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = await readFile(new URL('../manifest.yml', import.meta.url), 'utf8');
const routing = await readFile(new URL('../src/routingSettings.js', import.meta.url), 'utf8');
const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
const overrides = await readFile(new URL('../src/overrides.js', import.meta.url), 'utf8');
const overridesUi = await readFile(new URL('../src/frontend/overrides.jsx', import.meta.url), 'utf8');

test('routing safety page is admin-only and defaults off', () => {
  assert.match(routing, /getRoutingSettings/);
  assert.match(routing, /setAutomaticRouting/);
  assert.match(routing, /await assertAdmin\(\)/);
  assert.match(routing, /return value === true/);
});

test('background handlers consult persisted routing safety before execution', () => {
  assert.match(background, /getAutomaticRoutingEnabled/);
  assert.equal((background.match(/await automaticRoutingEnabled\(\)/g) || []).length, 2);
});

test('shift override mutations require Jira admin permission', () => {
  for (const resolver of ['getOverrideAdminData', 'saveShiftOverride', 'deleteShiftOverride']) assert.ok(overrides.includes(resolver));
  assert.ok((overrides.match(/await assertAdmin\(\)/g) || []).length >= 3);
});

test('shift overrides validate group membership and a positive time window', () => {
  assert.match(overrides, /Selected user is not a member of this shift group/);
  assert.match(overrides, /endAt <= startAt/);
});

test('cover and absence controls are visible in the admin UI', () => {
  for (const text of ['Temporary cover / include on shift', 'Temporary absence / exclude from shift', 'Current exceptions']) assert.ok(overridesUi.includes(text));
});

test('manifest wires routing safety and overrides as admin pages', () => {
  assert.match(manifest, /Shift Manager Routing Safety/);
  assert.match(manifest, /Shift Cover & Exceptions/);
  assert.match(manifest, /handler:\s*routingSettings\.handler/);
  assert.match(manifest, /handler:\s*overrides\.handler/);
});
