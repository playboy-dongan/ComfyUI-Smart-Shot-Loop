import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {ShotRunner,parseShots,extractVideos} from '../web/runner.js';
import {submitThroughApp,Cancellation} from '../web/bridge.js';
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.style={};this.textContent='';}
 append(...items){this.children.push(...items)}
 replaceChildren(...items){this.children=[...items]}
}
async function setup({deferGraph=false, unified=false, sound=true}={}) {
 let extension, root, releaseGraph, time=0, posts=[], rings=0;
 const listeners={};const events={};
 const data={output:{'1':{class_type:unified?'SmartShotLoop':'ShotLoopPrompts',inputs:{shots_json:JSON.stringify(Array.from({length:5},(_,i)=>({image:'i'+i,video:'v'+i}))) }},'2':{class_type:'MockVideo',inputs:{image:['1',0],video:['1',1]}}},workflow:{nodes:[]}};
 const api={
   apiURL:p=>p,
   addEventListener:(type,fn)=>listeners[type]=fn,
   queuePrompt:async(n,p)=>{posts.push(p);return {prompt_id:'p'+posts.length}},
   fetchApi:async path=>({ok:true,json:async()=>{
     if(path==='/queue')return {queue_running:[],queue_pending:[]};
     const id=path.split('/').at(-1);
     return {[id]:{status:{completed:true,status_str:'success'},outputs:{'2':{images:[{filename:id+'.mp4',type:'output'}]}}}};
   }})
 };
 const app={graph:{_nodes:[]},registerExtension:e=>extension=e,graphToPrompt:async()=>{
   if(deferGraph)await new Promise(r=>releaseGraph=r);return structuredClone(data);
 },queuePrompt:async function(){const p=await this.graphToPrompt();api.authToken='native';try{return await api.queuePrompt(0,p)}finally{delete api.authToken}}};
 let held=false;
 const navigator={locks:{request:async(name,opt,fn)=>{if(held)return fn(null);held=true;try{return await fn({name})}finally{held=false}}}};
 const context=vm.createContext({app,api,ShotRunner,parseShots,extractVideos,submitThroughApp,Cancellation,console,structuredClone,URLSearchParams,crypto:{randomUUID:()=> 'mock-run'},Date:{now:()=>++time},
   document:{createElement:t=>new Element(t)},navigator,
   sessionStorage:{map:new Map(),getItem(k){return this.map.get(k)},setItem(k,v){this.map.set(k,v)},removeItem(k){this.map.delete(k)}},
   setTimeout:fn=>{queueMicrotask(fn)},window:{confirm:()=>true,addEventListener:(t,f)=>events[t]=f,AudioContext:class{constructor(){this.state='running';this.currentTime=0;this.destination={}} async resume(){}async close(){}createOscillator(){return{frequency:{},connect(){},start(){rings++},stop(){}}}createGain(){return{gain:{},connect(){}}}}}});
 let source=await fs.readFile(new URL('../web/shot_loop.js',import.meta.url),'utf8');source=source.replace(/^import .*;\n/gm,'');
 vm.runInContext(source,context);
 class Node{constructor(){this.id=1;this.widgets=[{name:'prompt_node_id',value:'1'},{name:'video_output_node_id',value:'2'},{name:'timeout_minutes',value:2}];this.properties={};if(unified)this.widgets.push({name:'shots_json',value:data.output['1'].inputs.shots_json},{name:'delay_seconds',value:0},{name:'sound_enabled',value:sound},{name:'sound_volume',value:0.2})}addDOMWidget(n,t,r){root=r}setSize(){}}
 await extension.beforeRegisterNodeDef(Node,{name:unified?'SmartShotLoop':'ShotLoopGallery'});
 const node=new Node();node.onNodeCreated();
 const buttons=root.children[2].children;
 return {node,start:buttons[0],stop:buttons[1],gallery:root.children[3],posts,rings:()=>rings,listeners,ready:async()=>{while(!releaseGraph) await new Promise(r=>setImmediate(r))},releaseGraph:()=>releaseGraph(),status:root.children[0]};
}
test('full frontend mock renders five independent previews, rings once, persists descriptors',async()=>{
 const f=await setup();await f.start.onclick();assert.equal(f.posts.length,5);assert.equal(f.gallery.children.length,5);assert.equal(f.rings(),1);
 assert.equal(f.node.properties.shot_loop_results.length,5);assert.deepEqual(Object.keys(f.node.properties.shot_loop_results[0]),['shot','title','file']);
 f.node.onConfigure();assert.equal(f.gallery.children.length,5);assert.equal(f.posts.length,5);
});
test('actual UI stop during graph serialization prevents submit',async()=>{
 const f=await setup({deferGraph:true});const run=f.start.onclick();await f.ready();
 f.stop.onclick();f.releaseGraph();await run;assert.equal(f.posts.length,0);assert.equal(f.rings(),0);
});
test('actual UI reconnect during graph serialization prevents submit',async()=>{
 const f=await setup({deferGraph:true});const run=f.start.onclick();await f.ready();
 f.listeners.reconnecting();f.releaseGraph();await run;assert.equal(f.posts.length,0);
});
test('actual UI web lock rejects concurrent start without duplicate batch',async()=>{
 const f=await setup({deferGraph:true});const run=f.start.onclick();await f.ready();
 await f.start.onclick();assert.match(f.status.textContent,/另一个标签页/);f.stop.onclick();f.releaseGraph();await run;assert.equal(f.posts.length,0);
});

test('unified intelligent node submits its own five pairs without source id',async()=>{
 const f=await setup({unified:true});f.node.widgets=f.node.widgets.filter(w=>w.name!=='prompt_node_id');
 assert.match(f.start.textContent,/5 段/);await f.start.onclick();assert.equal(f.posts.length,5);assert.equal(f.rings(),1);assert.equal(f.gallery.children.length,5);
});
test('unified sound toggle disables oscillator but preserves five outputs',async()=>{
 const f=await setup({unified:true,sound:false});await f.start.onclick();assert.equal(f.posts.length,5);assert.equal(f.rings(),0);assert.equal(f.gallery.children.length,5);
});
