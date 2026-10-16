import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDesk} from '../server.mjs';
const fixture={schemaVersion:1,sources:[],leads:[{id:'test-1',name:'Test studio',researchStatus:'qualified',conflicts:[]}]};
test('real disk saves, restart, revision conflict, backup export and restore',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'bevamped-test-'));const dataFile=path.join(root,'bank.json'),stateDir=path.join(root,'state');await writeFile(dataFile,JSON.stringify(fixture));
 let desk=await createDesk({port:0,dataFile,stateDir,now:()=> '2026-10-16T12:00:00.000Z'});let base=`http://127.0.0.1:${desk.port}`;
 const post=async(revision,type,payload={})=>fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,command:{type,payload}})});
 try{
  let r=await post(0,'note',{leadId:'test-1',text:'A real saved note.'});assert.equal(r.status,200);let current=await r.json();assert.equal(current.state.revision,1);
  const disk=JSON.parse(await readFile(desk.stateFile,'utf8'));assert.equal(disk.leadStates['test-1'].notes[0].text,'A real saved note.');assert.equal((await readdir(desk.backupsDir)).length,1);
  r=await post(0,'note',{leadId:'test-1',text:'Must not overwrite.'});assert.equal(r.status,409);assert.equal(JSON.parse(await readFile(desk.stateFile,'utf8')).revision,1);
  const backup=await (await fetch(base+'/api/export?format=backup')).json();assert.equal(backup.state.leadStates['test-1'].notes.length,1);
  r=await post(1,'note',{leadId:'test-1',text:'Second note.'});assert.equal(r.status,200);
  r=await fetch(base+'/api/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:2,backup})});assert.equal(r.status,200);current=await r.json();assert.equal(current.state.revision,3);assert.equal(current.state.leadStates['test-1'].notes.length,1);assert.equal(current.state.events.at(-1).type,'backup_restored');
  await desk.close();desk=await createDesk({port:0,dataFile,stateDir});base=`http://127.0.0.1:${desk.port}`;current=await(await fetch(base+'/api/bootstrap')).json();assert.equal(current.state.revision,3);assert.equal(current.state.leadStates['test-1'].notes[0].text,'A real saved note.');
  r=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://another-site.invalid'},body:JSON.stringify({revision:3,command:{type:'start_day'}})});assert.equal(r.status,403);
  const csv=await(await fetch(base+'/api/export?format=csv')).text();assert.match(csv,/A real saved note/);assert.doesNotMatch(csv,/Second note/);
 }finally{await desk.close();await rm(root,{recursive:true,force:true});}
});
test('corrupt state is preserved and never silently replaced',async()=>{const root=await mkdtemp(path.join(tmpdir(),'bevamped-corrupt-'));const dataFile=path.join(root,'bank.json');await writeFile(dataFile,JSON.stringify(fixture));await writeFile(path.join(root,'workspace-state.json'),'broken json');try{await assert.rejects(createDesk({port:0,dataFile,stateDir:root}),/preserved/);assert.equal(await readFile(path.join(root,'workspace-state.json'),'utf8'),'broken json');}finally{await rm(root,{recursive:true,force:true});}});
test('transcript and review survive disk restart, export, and an outcome correction',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'bevamped-material-')),dataFile=path.join(root,'bank.json'),stateDir=path.join(root,'state');await writeFile(dataFile,JSON.stringify(fixture));
 let desk=await createDesk({port:0,dataFile,stateDir,now:()=> '2026-10-16T12:00:00Z'}),base=`http://127.0.0.1:${desk.port}`;
 const post=async(revision,type,payload)=>{const response=await fetch(base+'/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,command:{type,payload}})});assert.equal(response.status,200);return response.json();};
 try{
  await post(0,'approve',{leadId:'test-1',review:{portfolio:true,presence:true,contact:true,note:'Fixture approval only.'}});
  let current=await post(1,'log_call',{leadId:'test-1',outcome:'connected'});const callId=current.state.calls[0].id;
  const transcript='Seller: Fixture question.\nProspect: Fixture response.\n'+'Transcript fixture '.repeat(1000),coaching='Fixture coaching only.';
  await post(2,'save_call_material',{leadId:'test-1',callId,provider:'wispr_flow',notesUrl:'https://notes.wisprflow.ai/shared/test-fixture',transcript,summary:'Fixture summary.',coaching});
  const exported=await(await fetch(base+'/api/export?format=backup')).json();assert.equal(exported.state.calls[0].material.transcript,transcript);
  const csv=await(await fetch(base+'/api/export?format=csv')).text();assert.match(csv,/Call_Transcripts_And_Reviews/);assert.match(csv,/Fixture coaching only/);
  await desk.close();desk=await createDesk({port:0,dataFile,stateDir,now:()=> '2026-10-16T12:00:00Z'});base=`http://127.0.0.1:${desk.port}`;
  current=await(await fetch(base+'/api/bootstrap')).json();assert.equal(current.state.calls[0].material.transcript,transcript);assert.equal(current.state.calls[0].material.coaching,coaching);
  current=await post(3,'edit_call',{leadId:'test-1',callId,outcome:'no_answer'});assert.equal(current.state.calls[0].material.transcript,transcript);assert.equal(current.metrics.calls,1);assert.equal(current.metrics.bookings,0);
 }finally{await desk.close();await rm(root,{recursive:true,force:true});}
});
