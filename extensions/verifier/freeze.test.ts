import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { freezeTest, verifyIntact, frozenRel, stageFrozen } from './freeze.ts';

test('freeze + intact', () => {
  const d = mkdtempSync(join(tmpdir(), 'frz-'));
  const f = freezeTest(d, 'test_a.py', 'def test_x(): assert True\n');
  assert.equal(verifyIntact(f), true);
});

test('taint detection: content edit fails', () => {
  const d = mkdtempSync(join(tmpdir(), 'frz-'));
  const f = freezeTest(d, 'test_a.py', 'def test_x(): assert True\n');
  writeFileSync(f.path, 'def test_x(): assert False\n');
  assert.equal(verifyIntact(f), false);
});

test('taint detection: lock deletion fails', () => {
  const d = mkdtempSync(join(tmpdir(), 'frz-'));
  const f = freezeTest(d, 'test_a.py', 'x=1\n');
  unlinkSync(f.path + '.sha256');
  assert.equal(verifyIntact(f), false);
});

test('nested paths preserved without collision', () => {
  const d = mkdtempSync(join(tmpdir(), 'frz-'));
  const w = mkdtempSync(join(tmpdir(), 'frz-w-'));
  const fa = (() => { mkdirSync(join(d, 'tests', 'unit'), { recursive: true }); return freezeTest(join(d, 'tests', 'unit'), 'test_bug.py', 'v0\n'); })();
  const fb = (() => { mkdirSync(join(d, 'tests', 'integration'), { recursive: true }); return freezeTest(join(d, 'tests', 'integration'), 'test_bug.py', 'v1\n'); })();
  const s1 = stageFrozen(d, w, fa);
  const s2 = stageFrozen(d, w, fb);
  assert.notEqual(s1.path, s2.path);
  assert.equal(s1.path, join(w, 'tests', 'unit', 'test_bug.py'));
  assert.equal(s2.path, join(w, 'tests', 'integration', 'test_bug.py'));
  assert.equal(readFileSync(s1.path, 'utf8'), 'v0\n');
  assert.equal(readFileSync(s2.path, 'utf8'), 'v1\n');
  assert.equal(verifyIntact(s1), true);
  assert.equal(verifyIntact(s2), true);
});

test('escape rejected', () => {
  assert.throws(() => frozenRel('/repo', '/repo/../evil.py'), /escapes repo/);
  assert.throws(() => frozenRel('/repo', '/other/x.py'), /escapes repo/);
});
