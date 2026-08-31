import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const background = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');

test('automatic background routing remains disabled during internal QA', () => {
  assert.match(background, /AUTOMATIC_ROUTING_ENABLED\s*=\s*false/);
});

test('both background entry points enforce the QA gate', () => {
  const checks = background.match(/if \(!AUTOMATIC_ROUTING_ENABLED\)/g) || [];
  assert.equal(checks.length, 2);
});
