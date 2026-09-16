import {DatabaseSync} from 'node:sqlite';
import type {StateNode} from './nodes.ts';
export function openStore(path='state.db'){const db=new DatabaseSync(path);db.exec(`CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY,parent_id TEXT,branch_id TEXT,snapshot_ref TEXT,json TEXT)`);return{put(n:StateNode){db.prepare(`INSERT OR REPLACE INTO nodes VALUES(?,?,?,?,?)`).run(n.id,n.parent_id,n.branch_id,n.snapshot_ref,JSON.stringify(n))},get(id:string){const r=db.prepare(`SELECT json FROM nodes WHERE id=?`).get(id) as any;return r?JSON.parse(r.json) as StateNode:null}}}
