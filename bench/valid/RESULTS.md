# Validation results — SUPERSEDED (historical/pilot data only)

> The 11/11 below ran under a flawed protocol and is NOT evidence of
> benchmark performance. Two compounding defects, found during review:
> 1. `frozen-only` received an extra hidden-test hint (ablation contamination).
> 2. `py_compile .` fails unconditionally (EISDIR), so the lint gate was
>    always false — and only the beam arm bypassed lint in its pass criterion
>    (`frozen_pass` alone vs `frozen && lint` for all other arms). The
>    ✗/✗/✗/✓ pattern was largely artifact, not architecture effect.
> Corrected re-run below (or in progress) under identical-prompts +
> working-lint + unified ACCEPT-mirroring pass criteria.

## Old (void) numbers — 2026-09-16, contributor-free

12 tasks × 4 arms = 48 trials. 1 task void (v-merge: rate-limit zero-token across all arms, no measurement). n=11 valid.
Raw: `bench/valid/out/` (gitignored). Shared manifest, `tok_unit: pi-totalTokens` on all trials.

| arm | pass | tokens | × stock |
|---|---|---|---|
| stock | 0/11 | 230,811 | 1.00 |
| beam-only | 0/11 | 226,956 | 0.98 |
| frozen-only | 0/11 | 259,685 | 1.12 |
| beam+frozen | 11/11 | 415,399 | 1.80 |

Per-task beam+frozen ratios: 0.97–2.02× (early-stop: 1–2 branches typical, P2 never needed).
Every task went ✗/✗/✗/✓. Dev-green/frozen-fail observed repeatedly in beam-only (wrong fix, confident stop).

Reading: combination effect, not compute (beam-only ≈ stock tokens, still 0). Budget holds: 1.80× aggregate, worst task 2.02×.
Limit: n=11 synthetic, single model. 200-instance SWE-bench run is the real test.
