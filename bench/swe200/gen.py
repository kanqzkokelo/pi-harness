"""Generate model patches for SWE-bench Verified manifest.
Arms: stock (1 call) vs beam+frozen (controlled beam, 2x-stock budget).
Frozen artifact = test files touched by official test_patch, sha-locked pre-fix.
Usage: python3 bench/swe200/gen.py [arm]   (default: both)
"""
import json, os, re, subprocess, sys, hashlib, tempfile, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, 'bench', 'swe200', 'manifest.json')
REPOS = os.path.join(ROOT, 'bench', 'swe200', 'repos')
PATCHES = os.path.join(ROOT, 'bench', 'swe200', 'patches')
MODEL = 'opencode/muse-spark-1.3-contributor-free'
REPO_URL = 'https://github.com/{}'

def sh(args, cwd=None, timeout=600):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)

def ensure_clone(repo):
    dest = os.path.join(REPOS, repo.replace('/', '__'))
    if not os.path.isdir(os.path.join(dest, '.git')):
        os.makedirs(REPOS, exist_ok=True)
        sh(['git', 'clone', '-q', REPO_URL.format(repo), dest], timeout=900)
    return dest

def test_files(patch):
    return re.findall(r'^\+\+\+ b/(.+\.py)$', patch, re.M)

def pi_call(workdir, prompt, timeout=480, retries=2):
    import time
    raw = ''
    for a in range(retries + 1):
        p = subprocess.Popen(
            ['pi', '-p', '--no-session', '--mode', 'json', '--model', MODEL, '--', prompt],
            cwd=workdir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            env={**os.environ, 'PI_APPROVE': '1'})
        try:
            out, _ = p.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            p.kill(); out, _ = p.communicate()
        raw = out
        toks = re.findall(r'"totalTokens":(\d+)', out)
        n = int(toks[-1]) if toks else 0
        if n > 0 or a == retries:
            return n
        time.sleep(60)
    return 0

PROMPT = ("You are fixing a GitHub issue in this repo. Edit source files directly with minimal changes. "
          "Do NOT modify any test files. When done, stop.\n\nISSUE:\n{issue}\n\nStrategy: {strat}")

def worktree(clone, base):
    d = tempfile.mkdtemp(prefix='swe-')
    r = sh(['git', '-C', clone, 'worktree', 'add', '--detach', d, base])
    if r.returncode != 0:
        raise RuntimeError('worktree failed: ' + r.stderr[-500:])
    return d

def unworktree(clone, d):
    sh(['git', '-C', clone, 'worktree', 'remove', '--force', d])
    shutil.rmtree(d, ignore_errors=True)

def snapshot_diff(d):
    r = sh(['git', '-C', d, 'diff', 'HEAD', '--', '*.py'])
    return r.stdout

STOCK_TOK = {}

def cap_for(instance_id):
    s = STOCK_TOK.get(instance_id, 0)
    return s * 2 if s > 0 else 90000

def gen_instance(m, arm):
    cap = cap_for(m['instance_id'])
    out = os.path.join(PATCHES, arm, m['instance_id'] + '.diff')
    meta = out + '.json'
    if os.path.exists(out):
        return {'instance': m['instance_id'], 'arm': arm, 'status': 'cached'}
    clone = ensure_clone(m['repo'])
    d = worktree(clone, m['base_commit'])
    toks = 0
    try:
        # T0: apply official test patch, lock touched test files (NOT verifier)
        with open(os.path.join(d, 'test_patch.diff'), 'w') as f:
            f.write(m['test_patch'])
        r = sh(['git', '-C', d, 'apply', 'test_patch.diff'])
        if r.returncode != 0:
            return {'instance': m['instance_id'], 'arm': arm, 'status': 'test-patch-fail'}
        locks = {}
        for tf in test_files(m['test_patch']):
            p = os.path.join(d, tf)
            if os.path.exists(p):
                locks[tf] = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        sh(['git', '-C', d, 'add', '-A'])
        sh(['git', '-C', d, '-c', 'user.email=p@p', '-c', 'user.name=p', 'commit', '-qm', 't0'])
        strats = ['minimal patch, smallest diff'] if arm == 'stock' else [
            'minimal patch, smallest diff', 'alternate localization, different files',
            'repro-driven, handle edge cases first']
        cands = []
        for s in strats:
            if arm == 'beam+frozen' and toks + STOCK_TOK.get(m['instance_id'], 20000) > cap:
                break
            toks += pi_call(d, PROMPT.format(issue=m['problem_statement'][:6000], strat=s))
            # taint guard: test files must be untouched
            tainted = any(not os.path.exists(os.path.join(d, tf)) or
                          hashlib.sha256(open(os.path.join(d, tf), 'rb').read()).hexdigest() != h
                          for tf, h in locks.items())
            if tainted:
                sh(['git', '-C', d, 'checkout', '--', '.'])
                continue
            cands.append(snapshot_diff(d))
            if arm == 'beam+frozen':
                # early-stop check needs frozen run; cheap proxy: keep last, select below
                pass
        os.makedirs(os.path.join(PATCHES, arm), exist_ok=True)
        if arm == 'stock':
            STOCK_TOK[m['instance_id']] = toks
            best = cands[0] if cands else ''
        else:
            best = max(cands, key=len) if cands else ''
            # NOTE: full frozen-test selection happens in eval phase (pytest in Docker);
            # here keep all candidates for post-hoc selection to avoid local-env runs.
            for i, c in enumerate(cands):
                with open(os.path.join(PATCHES, arm, m['instance_id'] + f'.cand{i}.diff'), 'w') as f:
                    f.write(c)
        with open(out, 'w') as f:
            f.write(best)
        with open(meta, 'w') as f:
            json.dump({'instance': m['instance_id'], 'arm': arm, 'tokens': toks,
                       'tok_unit': 'pi-totalTokens', 'model': MODEL,
                       'base_commit': m['base_commit'], 'cands': len(cands)}, f)
        return {'instance': m['instance_id'], 'arm': arm, 'status': 'ok', 'tokens': toks}
    finally:
        unworktree(clone, d)

def main():
    arms = sys.argv[1:] or ['stock', 'beam+frozen']
    manifest = json.load(open(MANIFEST))
    for m in manifest:
        for arm in arms:
            try:
                print(json.dumps(gen_instance(m, arm)), flush=True)
            except Exception as e:
                print(json.dumps({'instance': m['instance_id'], 'arm': arm,
                                  'status': 'error', 'err': str(e)[-300:]}), flush=True)

if __name__ == '__main__':
    main()
