import {ACCEPT} from '../state-graph/nodes.ts';import type {StateNode} from '../state-graph/nodes.ts';
export const winner=(ns:StateNode[],parentRate:number)=>[...ns].sort((a,b)=>Number(b.test_results.frozen_pass)-Number(a.test_results.frozen_pass)||b.test_results.suite_pass_rate-a.test_results.suite_pass_rate)[0];
export const anyAccepts=(ns:StateNode[],parentRate:number)=>ns.some(n=>ACCEPT(n,parentRate));
