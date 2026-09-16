"""Sample 200 SWE-bench Verified instances (seeded) -> bench/swe200/manifest.json."""
import json, random, subprocess, sys

N = int(sys.argv[1]) if len(sys.argv) > 1 else 200
SEED = 7
OUT = 'bench/swe200/manifest.json'

def main():
    from datasets import load_dataset
    ds = load_dataset('SWE-bench/SWE-bench_Verified', split='test')
    ids = sorted(r['instance_id'] for r in ds)
    rng = random.Random(SEED)
    pick = sorted(rng.sample(ids, N))
    by_id = {r['instance_id']: r for r in ds}
    manifest = []
    for i in pick:
        r = by_id[i]
        manifest.append({
            'instance_id': i,
            'repo': r['repo'],
            'base_commit': r['base_commit'],
            'problem_statement': r['problem_statement'],
            'test_patch': r['test_patch'],
            'fail_to_pass': list(r['FAIL_TO_PASS']),
            'pass_to_pass': list(r['PASS_TO_PASS'][:20]),
            'environment_setup_commit': r.get('environment_setup_commit', ''),
        })
    with open(OUT, 'w') as f:
        json.dump(manifest, f)
    print(f'wrote {len(manifest)} -> {OUT}')
    print('repos:', sorted({m['repo'] for m in manifest}))

if __name__ == '__main__':
    main()
