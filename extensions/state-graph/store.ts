import { DatabaseSync } from 'node:sqlite';
import type { StateNode, Edge } from './nodes.ts';

export interface EventRec { ts: number; kind: string; node_id: string | null; detail: string }

/** sqlite store: nodes + edges + append-only event/cost log. */
export function openStore(path = 'state.db') {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY, parent_id TEXT, branch_id TEXT, snapshot_ref TEXT, json TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS edges(from_id TEXT, to_id TEXT, reason TEXT)`);
  db.exec(`CREATE TABLE IF NOT EXISTS events(ts INTEGER, kind TEXT, node_id TEXT, detail TEXT)`);
  const log = (kind: string, node_id: string | null, detail: unknown) =>
    db.prepare(`INSERT INTO events VALUES(?,?,?,?)`).run(Date.now(), kind, node_id, JSON.stringify(detail));
  return {
    put(n: StateNode) {
      db.prepare(`INSERT OR REPLACE INTO nodes VALUES(?,?,?,?,?)`).run(n.id, n.parent_id, n.branch_id, n.snapshot_ref, JSON.stringify(n));
      log('node', n.id, { parent: n.parent_id, branch: n.branch_id, tests: n.test_results, cost: n.cost });
    },
    get(id: string): StateNode | null {
      const r = db.prepare(`SELECT json FROM nodes WHERE id=?`).get(id) as { json: string } | undefined;
      return r ? (JSON.parse(r.json) as StateNode) : null;
    },
    children(id: string): StateNode[] {
      const rows = db.prepare(`SELECT json FROM nodes WHERE parent_id=?`).all(id) as { json: string }[];
      return rows.map((r) => JSON.parse(r.json) as StateNode);
    },
    link(e: Edge) {
      db.prepare(`INSERT INTO edges VALUES(?,?,?)`).run(e.from, e.to, e.reason);
      log('edge', e.to, e);
    },
    events(): EventRec[] {
      return (db.prepare(`SELECT ts,kind,node_id,detail FROM events ORDER BY ts`).all() as any[]).map((r) => ({
        ts: r.ts, kind: r.kind, node_id: r.node_id, detail: r.detail,
      }));
    },
    close() { db.close(); },
  };
}
export type Store = ReturnType<typeof openStore>;
