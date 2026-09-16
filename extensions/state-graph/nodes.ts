export type BranchId='A'|'B'|'C';
export interface Subtask{ modestatus:string } // placeholder
export interface StateNode{id:string;parent_id:string|null;branch_id:BranchId;snapshot_ref:string;subtasks:{id:string;title:string;status:'todo'|'doing'|'done'|'blocked'}[];facts:string[];actions:{tool:string;args:string;result_hash:string;ts:number}[];test_results:{frozen_pass:boolean;suite_pass_rate:number;lint:boolean};cost:{tokens:number;tool_calls:number;ms:number}}
export const ACCEPT=(n:StateNode,parentRate:number)=>n.test_results.frozen_pass&&n.test_results.suite_pass_rate>=parentRate&&n.test_results.lint;
