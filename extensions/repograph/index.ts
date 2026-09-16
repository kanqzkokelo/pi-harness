import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const SYM = /^(?:export\s+)?(?:async\s+)?(?:function|class|def|const|let|var)\s+([A-Za-z0-9_]+)|^([A-Za-z0-9_]+)\s*=\s*(?:\(.*\)\s*=>|function)/gm;
const IMP = /^(?:import\s+(.+?)\s+from|from\s+(\S+)\s+import|import\s+(\S+)|require\(['"](.+?)['"]\))/gm;
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);

function files(root: string, out: string[] = []): string[] {
  for (const e of readdirSync(root)) {
    if (e.startsWith('.') || e === 'node_modules' || e === '__pycache__') continue;
    const p = join(root, e);
    try { if (statSync(p).isDirectory()) files(p, out); else if (EXTS.has(extname(p))) out.push(p); } catch { /* skip */ }
  }
  return out;
}
/** Build once per repo: symbols + imports -> sqlite. Upgrade path: tree-sitter. */
export function buildIndex(repoDir: string, dbPath: string): number {
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS symbols(name TEXT, file TEXT, line INTEGER)`);
  db.exec(`CREATE TABLE IF NOT EXISTS imports(file TEXT, ref TEXT)`);
  db.exec(`DELETE FROM symbols; DELETE FROM imports`);
  let n = 0;
  for (const f of files(repoDir)) {
    let src = '';
    try { src = readFileSync(f, 'utf8'); } catch { continue; }
    const lines = src.split('\n');
    let m: RegExpExecArray | null;
    SYM.lastIndex = 0;
    while ((m = SYM.exec(src))) { db.prepare(`INSERT INTO symbols VALUES(?,?,?)`).run(m[1] ?? m[2], f, 0); n++; }
    IMP.lastIndex = 0;
    while ((m = IMP.exec(src))) { db.prepare(`INSERT INTO imports VALUES(?,?)`).run(f, (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').slice(0, 200)); }
    void lines;
  }
  db.close();
  return n;
}
if (process.argv[1]?.endsWith('index.ts')) {
  const [repo, db] = process.argv.slice(2);
  if (repo && db) console.log('symbols:', buildIndex(repo, db));
}
