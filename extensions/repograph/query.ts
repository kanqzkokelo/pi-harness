import { DatabaseSync } from 'node:sqlite';

/** Ego-graph lite: score files by keyword hits in symbols + path. Top-k=8 default. */
export function topK(dbPath: string, keywords: string[], k = 8): string[] {
  const db = new DatabaseSync(dbPath);
  const scores = new Map<string, number>();
  const kws = keywords.map((s) => s.toLowerCase()).filter(Boolean);
  try {
    const rows = db.prepare(`SELECT name, file FROM symbols`).all() as { name: string; file: string }[];
    for (const r of rows) {
      const nl = r.name.toLowerCase(), fl = r.file.toLowerCase();
      let s = 0;
      for (const q of kws) { if (nl.includes(q)) s += 3; if (fl.includes(q)) s += 1; }
      if (s > 0) scores.set(r.file, (scores.get(r.file) ?? 0) + s);
    }
  } finally { db.close(); }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([f]) => f);
}
