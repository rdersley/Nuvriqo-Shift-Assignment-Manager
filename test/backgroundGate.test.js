import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');
const settings = await readFile(new URL('../src/routingSettings.js', import.meta.url), 'utf8');

test('automatic routing defaults to off when no setting exists', () => {
  assert.match(settings, /return value === true/);
});

test('background routing fails closed if settings cannot be read', () => {
  assert.match(background, /failing closed/);
  assert.match(background, /return false/);
});

test('both background entry points enforce the routing setting', () => {
  const checks = background.match(/await automaticRoutingEnabled\(\)/g) || [];
  assert.equal(checks.length, 2);
});

test('routing setting writes require Jira admin permission', () => {
  assert.match(settings, /setAutomaticRouting/);
  assert.match(settings, /await assertAdmin\(\)/);
  assert.match(settings, /payload\?\.enabled === true/);
});
