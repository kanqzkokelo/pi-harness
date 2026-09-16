# RESUME (after reboot)

Gen process dies with PC. Cached diffs survive. Stale /tmp worktrees do not.

```bash
cd /home/mitesh/Storage/repos/pi-harness
git pull -q
# prune dead worktrees in cached clones
for r in bench/swe200/repos/*/; do git -C "$r" worktree prune; done
# relaunch gen (skips cached diffs automatically)
mkdir -p bench/swe200/patches bench/swe200/out
nohup python3 bench/swe200/gen.py stock beam+frozen > bench/swe200/out/gen.log 2>&1 &
# watch
watch -n60 'ls bench/swe200/patches/stock/*.diff bench/swe200/patches/beam+frozen/*.diff 2>/dev/null | wc -l; tail -1 bench/swe200/out/gen.log'
```

After gen 400/400: eval phase (per-image pull→test→rmi, disk guard). See HARNESS_SPEC.md §14.
Validation record: beam+frozen 11/11 at 1.8×, others 0/11 (bench/valid/RESULTS.md).
