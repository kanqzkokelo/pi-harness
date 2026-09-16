/** Single source of arm prompts. F1: all arms share the identical base task
 *  description. Strategy suffixes exist only on beam arms, where prompt
 *  diversity IS the branching mechanism under test. No arm receives hints
 *  about hidden/frozen acceptance tests. */
export function basePrompt(brief: string): string {
  return `Fix the bug in this repo by editing files directly. Bug: ${brief} Keep changes minimal. Do not modify test files. When done, stop.`;
}

export function strategyPrompt(brief: string, strategy: string): string {
  return `${basePrompt(brief).replace(/ When done, stop\.$/, '')} Strategy: ${strategy}. When done, stop.`;
}

/** Beam strategy set. Identical for beam-only and beam+frozen. */
export const BEAM_STRATEGIES = [
  'minimal patch, smallest diff',
  'alternate approach, rewrite function body',
  'repro-driven, handle edge cases first',
] as const;

/** Automated parity assertion: stock and frozen-only prompts must be
 *  byte-identical; beam arms must share the base prompt plus their
 *  (identical-across-beam-arms) strategy suffixes. Throws on mismatch. */
export function assertPromptParity(brief: string): void {
  const stock = basePrompt(brief);
  const frozenOnly = basePrompt(brief);
  if (stock !== frozenOnly) throw new Error('prompt parity violated: stock !== frozen-only');
  for (const s of BEAM_STRATEGIES) {
    const p = strategyPrompt(brief, s);
    if (!p.startsWith(stock.replace(/ When done, stop\.$/, ''))) {
      throw new Error(`prompt parity violated: beam strategy prompt diverged from base: ${s}`);
    }
    if (/hidden|frozen|acceptance test/i.test(p)) {
      throw new Error('prompt parity violated: semantic hint leaked into beam prompt');
    }
  }
  if (/hidden|frozen|acceptance test/i.test(stock)) {
    throw new Error('prompt parity violated: semantic hint leaked into base prompt');
  }
}
