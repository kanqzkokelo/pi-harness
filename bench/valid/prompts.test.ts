import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basePrompt, strategyPrompt, assertPromptParity, BEAM_STRATEGIES } from './prompts.ts';

const BRIEFS = [
  'rsum(n) should return sum of 1..n inclusive, currently off by one.',
  'merge(a,b) must deep-merge nested dicts.',
];

for (const b of BRIEFS) {
  test(`stock === frozen-only prompt: ${b.slice(0, 30)}`, () => {
    assertPromptParity(b); // throws on any mismatch or hint leak
  });
}

test('beam strategies share base, differ only by suffix', () => {
  const b = BRIEFS[0];
  const base = basePrompt(b).replace(/ When done, stop\.$/, '');
  const ps = BEAM_STRATEGIES.map((s) => strategyPrompt(b, s));
  assert.equal(new Set(ps).size, BEAM_STRATEGIES.length);
  for (const p of ps) assert.ok(p.startsWith(base), 'strategy prompt must extend base');
});

test('no hidden/frozen hint in any prompt', () => {
  for (const b of BRIEFS) {
    assert.ok(!/hidden|frozen|acceptance test/i.test(basePrompt(b)));
    for (const s of BEAM_STRATEGIES) assert.ok(!/hidden|frozen|acceptance test/i.test(strategyPrompt(b, s)));
  }
});
