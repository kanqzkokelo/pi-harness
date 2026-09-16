import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preflight, runAblation, type Manifest, type TaskDef, type Arm } from './ablation.ts';

const task = (over: Partial<TaskDef> = {}): TaskDef => ({
  id: 't1', repoDir: '/r', base_commit: 'abc', brief: 'Fix the bug.',
  frozen: { path: '/r/test_t0.py', sha: 'dead' },
  model: 'm', suiteCmd: 'true', token_budget: 1000, env: { image: 'img', seed: 7 },
  ...over,
});
const prompts = (stock: string, frozenOnly: string): Record<Arm, (t: TaskDef) => string> => ({
  stock: () => stock,
  'frozen-only': () => frozenOnly,
  'beam-only': () => stock + ' Strategy: minimal.',
  'beam+frozen': () => stock + ' Strategy: minimal.',
});

test('preflight passes on identical inputs', () => {
  const d = mkdtempSync(join(tmpdir(), 'pre-'));
  preflight({ tasks: [task()] }, d, prompts('same', 'same'));
});

test('preflight aborts on stock/frozen-only prompt divergence', () => {
  const d = mkdtempSync(join(tmpdir(), 'pre-'));
  assert.throws(() => preflight({ tasks: [task()] }, d, prompts('a', 'b')), /preflight failed/);
});

test('preflight aborts on missing fields', () => {
  const d = mkdtempSync(join(tmpdir(), 'pre-'));
  assert.throws(() => preflight({ tasks: [task({ brief: '' })] }, d), /preflight failed/);
});

test('preflight aborts on empty manifest', () => {
  const d = mkdtempSync(join(tmpdir(), 'pre-'));
  assert.throws(() => preflight({ tasks: [] }, d), /preflight failed/);
});

test('preflight writes machine-readable failure', () => {
  const d = mkdtempSync(join(tmpdir(), 'pre-'));
  try { preflight({ tasks: [task({ brief: '' })] }, d); } catch { /* expected */ }
  const fails = JSON.parse(readFileSync(join(d, 'preflight-fail.json'), 'utf8'));
  assert.equal(fails[0].task, 't1');
  assert.equal(fails[0].field, 'brief');
});

test('runAblation refuses to run on preflight failure', async () => {
  const d = mkdtempSync(join(tmpdir(), 'pre-'));
  const exec = async () => ({ pass: false, tokens: 1, ms: 1, tool_calls: 1 });
  await assert.rejects(
    runAblation({ tasks: [task()] } as Manifest, { stock: exec, 'beam-only': exec, 'frozen-only': exec, 'beam+frozen': exec }, d, { prompts: prompts('a', 'b') }),
    /preflight failed/,
  );
});
