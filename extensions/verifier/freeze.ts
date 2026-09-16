// T0 TEST/SPEC CONSTRUCTION — NOT verifier. Generates repro tests pre-fix, sha256 locks.
import {createHash} from 'node:crypto';
export function lockTest(src:string){return{src,sha:createHash('sha256').update(src).digest('hex')}}
