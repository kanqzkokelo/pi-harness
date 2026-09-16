// git commit per node, worktree per branch. TODO: fork pi, wire here.
import {execFileSync} from 'node:child_process';
export const commitNode=(msg:string)=>execFileSync('git',['add','-A'],{stdio:'pipe'}).toString()+execFileSync('git',['commit','-m',msg,'--allow-empty'],{encoding:'utf8'});
export const checkout=(sha:string)=>execFileSync('git',['checkout',sha],{stdio:'pipe'});
