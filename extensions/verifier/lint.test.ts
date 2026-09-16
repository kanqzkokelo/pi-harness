import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { lintRepo } from './lint.ts';

const init = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lint-'));
  execFileSync('git', ['init', '-q'], { cwd: d });
  return d;
};

test('valid files pass', () => {
  const d = init();
  writeFileSync(join(d, 'a.py'), 'x = 1\n');
  execFileSync('git', ['add', '-A'], { cwd: d });
  assert.equal(lintRepo(d), true);
});

test('syntax error fails', () => {
  const d = init();
  writeFileSync(join(d, 'a.py'), 'def broken(:\n');
  execFileSync('git', ['add', '-A'], { cwd: d });
  assert.equal(lintRepo(d), false);
});

test('no python files passes (vacuous)', () => {
  const d = init();
  writeFileSync(join(d, 'README.md'), 'hi\n');
  execFileSync('git', ['add', '-A'], { cwd: d });
  assert.equal(lintRepo(d), true);
});

test('untracked broken file ignored (tracked-only scope)', () => {
  const d = init();
  writeFileSync(join(d, 'a.py'), 'x = 1\n');
  execFileSync('git', ['add', '-A'], { cwd: d });
  writeFileSync(join(d, 'scratch.py'), 'def broken(:\n');
  assert.equal(lintRepo(d), true);
});
