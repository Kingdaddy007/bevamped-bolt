import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
const scheduler=source.slice(source.indexOf('function scheduleSync(id){'),source.indexOf('\nasync function syncCall'));
function setup(){
 const info={textContent:''},pause={disabled:false,textContent:''};let timer=null,delay=0,calls=0;
 const context=vm.createContext({syncTimer:null,syncAttempts:1,syncPaused:false,syncSessionId:'fixture',modal:{open:true,querySelector:s=>s.includes('session-pause')?pause:info},clearTimeout:()=>timer=null,setTimeout:(fn,ms)=>{timer=fn;delay=ms;return 1;},syncCall:()=>calls++});
 vm.runInContext(scheduler,context);
 return {context,info,pause,get timer(){return timer;},get delay(){return delay;},get calls(){return calls;}};
}
test('waiting sync schedules one retry after thirty seconds and stops at two total checks',()=>{
 const x=setup();x.context.scheduleSync('fixture');assert.equal(x.delay,30000);assert.ok(x.timer);x.timer();assert.equal(x.calls,1);
 x.context.syncAttempts=2;x.context.scheduleSync('fixture');assert.equal(x.timer,null);assert.equal(x.context.syncPaused,true);assert.equal(x.pause.disabled,true);assert.match(x.info.textContent,/Two checks completed/);
});
test('manual pause prevents a scheduled retry from making a request',()=>{
 const x=setup();x.context.scheduleSync('fixture');const pending=x.timer;x.context.syncPaused=true;x.context.scheduleSync('fixture');assert.equal(x.timer,null);pending();assert.equal(x.calls,0);assert.match(x.info.textContent,/Checking is paused/);
});
test('closed dialog or a different selected session cannot trigger a delayed check',()=>{
 const x=setup();x.context.scheduleSync('fixture');const pending=x.timer;x.context.modal.open=false;pending();assert.equal(x.calls,0);x.context.modal.open=true;x.context.syncSessionId='another';pending();assert.equal(x.calls,0);
});
