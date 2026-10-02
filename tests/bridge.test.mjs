import test from 'node:test';
import assert from 'node:assert/strict';
import {submitThroughApp, Cancellation} from '../web/bridge.js';
function fixture() {
 const posts=[];
 const api={queuePrompt:async function(n,p,o){posts.push({n,p,o,auth:this.authToken});return {prompt_id:'p1'}}};
 const app={graphToPrompt:async()=>({output:{original:{}}}),processingQueue:false,queueItems:[],queuePrompt:async function(n,count){
   this.processingQueue=true;
   try {const p=await this.graphToPrompt();api.authToken='existing-session';try{return await api.queuePrompt(n,p,{previewMethod:'auto'})} finally {delete api.authToken;}}
   finally {this.processingQueue=false;}
 }};
 return {app,api,posts};
}
test('app path forwards existing auth and options, restores all methods',async()=>{
 const {app,api,posts}=fixture(), original=[app.queuePrompt,app.graphToPrompt,api.queuePrompt];
 const data={output:{shot:{}}}; await submitThroughApp(app,api,data,()=>{});
 assert.equal(posts.length,1); assert.equal(posts[0].auth,'existing-session');assert.equal(posts[0].p,data);
 assert.deepEqual(posts[0].o,{previewMethod:'auto'});assert.deepEqual([app.queuePrompt,app.graphToPrompt,api.queuePrompt],original);
 assert.equal(api.authToken,undefined);
});
test('cancellation before preflight finishes prevents all network submits',async()=>{
 const c=new Cancellation(); const {app,api,posts}=fixture();
 let resolve; const preflight=new Promise(r=>{resolve=r});
 const run=(async()=>{await preflight;c.check();await submitThroughApp(app,api,{},()=>c.check())})();
 c.cancel('stop during graphToPrompt');resolve();await assert.rejects(run,/stop during/);assert.equal(posts.length,0);
});
test('cancellation during native app authentication prevents POST and restores',async()=>{
 const f=fixture(), c=new Cancellation();const original=f.app.queuePrompt;
 f.app.queuePrompt=async function(){c.cancel();return original.call(this,0,1)};
 const saved=f.app.queuePrompt;
 await assert.rejects(submitThroughApp(f.app,f.api,{},()=>c.check()),/停止/);assert.equal(f.posts.length,0);assert.equal(f.app.queuePrompt,saved);
});
test('network uncertainty never retried and wrappers restored',async()=>{
 const f=fixture();f.api.queuePrompt=async()=>{throw new Error('lost response')};const saved=f.api.queuePrompt;
 await assert.rejects(submitThroughApp(f.app,f.api,{},()=>{}),/lost response/);assert.equal(f.api.queuePrompt,saved);
});
test('busy app rejected before replacing methods',async()=>{
 const f=fixture();f.app.processingQueue=true;const saved=f.app.queuePrompt;
 await assert.rejects(submitThroughApp(f.app,f.api,{},()=>{}),/其他提交/);assert.equal(f.app.queuePrompt,saved);
});
test('other callers cannot hijack temporary graph or create duplicate submit',async()=>{
 const f=fixture(); let intruderError;
 const original=f.app.queuePrompt;
 f.app.queuePrompt=async function(){try{await this.queuePrompt(0,5)}catch(e){intruderError=e}return original.call(this,0,1)};
 await submitThroughApp(f.app,f.api,{},()=>{}); assert.match(intruderError.message,/重复点击/);assert.equal(f.posts.length,1);
});
