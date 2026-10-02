import test from 'node:test';
import assert from 'node:assert/strict';
import {ShotRunner, parseShots, extractVideos} from '../web/runner.js';
function fixture(count=5) {
  const snapshot={output:{'1':{class_type:'ShotLoopPrompts',inputs:{shots_json:JSON.stringify(Array.from({length:count},(_,i)=>({image:'image'+i,video:'video'+i}))) }},'9':{class_type:'SaveVideo',inputs:{}}}};
  let posts=[], notifications=0, clock=0;
  const io={token:()=> 'test',now:()=>clock,sleep:async()=>{clock+=1000},status:()=>{},result:()=>{},notify:async()=>{notifications++},
    submit:async d=>{posts.push(d); return {prompt_id:'p'+posts.length}},
    history:async id=>({status:{completed:true,status_str:'success'},outputs:{'9':{videos:[{filename:id+'.mp4',type:'output'}]}}})};
  const r=new ShotRunner(io);
  return {r,io,snapshot,posts,notifications:()=>notifications};
}
test('five sequential jobs, fresh index/token, one sound, immutable snapshot',async()=>{
 const f=fixture(); const results=await f.r.run(f.snapshot,'1','9',5000);
 assert.equal(results.length,5); assert.equal(f.notifications(),1);
 assert.deepEqual(f.posts.map(p=>p.output['1'].inputs.shot_index),[0,1,2,3,4]);
 assert.equal(f.snapshot.output['1'].inputs.shot_index,undefined);
});
test('failure on second stops before third and never notifies',async()=>{
 const f=fixture(); const success=f.io.history;
 f.io.history=async id=>id==='p2'?{status:{status_str:'error'}}:success(id);
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000),/执行失败/); assert.equal(f.posts.length,2); assert.equal(f.notifications(),0);
});
test('cancel during submit records current id but never submits again',async()=>{
 const f=fixture(); f.io.submit=async d=>{f.posts.push(d); f.r.cancel(); return {prompt_id:'p1'}};
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000),/已停止/); assert.equal(f.posts.length,1); assert.equal(f.r.current,'p1');
});
test('cancel while waiting ignores late completed result',async()=>{
 const f=fixture(); const success=f.io.history; f.io.history=async id=>{f.r.cancel(); return success(id)};
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000)); assert.equal(f.r.results.length,0); assert.equal(f.posts.length,1);
});
test('double click cannot start a second run',async()=>{
 const f=fixture(); let release; f.io.history=()=>new Promise(r=>{release=r});
 const running=f.r.run(f.snapshot,'1','9',5000); await Promise.resolve();
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000),/重复提交/);
 f.r.cancel(); release({}); await assert.rejects(running); assert.equal(f.posts.length,1);
});
test('timeout never queues next shot',async()=>{
 const f=fixture(); f.io.history=async()=>undefined;
 await assert.rejects(f.r.run(f.snapshot,'1','9',1500),/超时/); assert.equal(f.posts.length,1);
});
test('uncertain submission is never retried',async()=>{
 const f=fixture(); f.io.submit=async d=>{f.posts.push(d); throw new Error('network lost')};
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000),/network lost/); assert.equal(f.posts.length,1);
});
test('missing or overwritten outputs stop before further jobs',async()=>{
 const f=fixture(); f.io.history=async()=>({status:{completed:true,status_str:'success'},outputs:{'9':{gifs:[{filename:'same.mp4'}]}}});
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000),/路径重复/); assert.equal(f.posts.length,2);
 const g=fixture(); g.io.history=async()=>({status:{completed:true,status_str:'success'},outputs:{}});
 await assert.rejects(g.r.run(g.snapshot,'1','9',5000),/识别到 0/); assert.equal(g.posts.length,1);
});
test('invalid prompt pairs, empty list, URLs and nonvideo descriptors rejected',()=>{
 assert.throws(()=>parseShots('[]')); assert.throws(()=>parseShots('[{"image":"a"}]'));
 assert.deepEqual(extractVideos({videos:['https://external/x.mp4'],images:[{filename:'a.png'}]}),[]);
});
test('count derives from prompt pairs instead of fixed loops',async()=>{
 const f=fixture(3); await f.r.run(f.snapshot,'1','9',5000); assert.equal(f.posts.length,3);
});
test('cached standard SaveVideo descriptors accepted and independent prompt ids retained',async()=>{
 const f=fixture(); f.io.history=async id=>({status:{completed:true,status_str:'success',messages:[['execution_cached',{nodes:['2']}]]},outputs:{'9':{images:[{filename:id+'.mp4',subfolder:'shot_loop/test',type:'output'}]},'99':{images:[{filename:'unrelated.mp4'}]}}});
 const r=await f.r.run(f.snapshot,'1','9',5000);assert.deepEqual(r.map(x=>x.promptId),['p1','p2','p3','p4','p5']);assert.equal(r.length,5);
});
test('unexpected non-success completed status never treated as success',async()=>{
 const f=fixture();f.io.history=async()=>({status:{completed:true,status_str:'interrupted'}});
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000),/未成功/);assert.equal(f.notifications(),0);
});
test('custom inter-shot delay applies only between jobs and keeps captions',async()=>{
 const f=fixture(3);f.snapshot.output['1'].class_type='SmartShotLoop';
 const shots=JSON.parse(f.snapshot.output['1'].inputs.shots_json);shots[0].title='海边';f.snapshot.output['1'].inputs.shots_json=JSON.stringify(shots);
 let elapsed=0;f.io.sleep=async ms=>{elapsed+=ms};const results=await f.r.run(f.snapshot,'1','9',5000,1500);
 assert.equal(elapsed,3000);assert.equal(results[0].title,'海边');assert.equal(f.notifications(),1);
});
test('cancel during inter-shot delay prevents next submission',async()=>{
 const f=fixture(3);f.io.sleep=async()=>{f.r.cancel('stop during delay')};
 await assert.rejects(f.r.run(f.snapshot,'1','9',5000,1500),/stop during delay/);assert.equal(f.posts.length,1);assert.equal(f.notifications(),0);
});
