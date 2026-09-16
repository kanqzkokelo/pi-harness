import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePytestSummary } from './run.ts';

const cases: [string, string, number][] = [
  ['20 passed', 'plain pass', 1],
  ['1 failed, 20 passed', 'fail-first order', 20 / 21],
  ['20 passed, 1 failed', 'pass-first order', 20 / 21],
  ['1 failed, 19 passed, 2 skipped', 'skipped excluded', 19 / 20],
  ['20 passed, 1 skipped', 'skipped excluded 2', 1],
  ['1 error', 'error counts as failure', 0],
  ['2 passed, 1 error', 'error in denom', 2 / 3],
  ['no tests ran', 'zero-test case', 0],
  ['', 'empty output', 0],
  ['ERROR collecting test_x.py', 'collection error', 0],
];

for (const [out, name, want] of cases) {
  test(`parser: ${name}`, () => {
    const { rate } = parsePytestSummary(`=== ${out} in 1.2s ===\n${out}\n`);
    assert.ok(Math.abs(rate - want) < 1e-9, `${name}: got ${rate}, want ${want}`);
  });
}

test('parser: uses last result line on rerun output', () => {
  const out = '=== 1 failed, 1 passed in 2s ===\nFAILED...\n=== 2 passed in 1s ===\n';
  assert.equal(parsePytestSummary(out).rate, 1);
});
