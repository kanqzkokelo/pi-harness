// VERIFIER = deterministic execution only: frozen pytest + suite subset + lint/typecheck.
export interface Verdict{frozen_pass:boolean;suite_pass_rate:number;lint:boolean}
export function rank(v:Verdict[]){return v} // TODO: frozen desc, rate desc, diff asc
