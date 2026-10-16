import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createWispr,wisprLink,rpcResponse,windowsVault} from '../wispr.mjs';
import {createDesk} from '../server.mjs';

const resource='https://api.wisprflow.ai/connect/mcp',issuer='https://mcp-auth.wisprflow.com';
const metadata={issuer,authorization_endpoint:issuer+'/oauth2/authorize',token_endpoint:issuer+'/oauth2/token',registration_endpoint:issuer+'/oauth2/register',code_challenge_methods_supported:['S256']};
const fixture={schemaVersion:1,sources:[],leads:[{id:'one',name:'Fixture Studio',researchStatus:'qualified',conflicts:[]},{id:'two',name:'Second Fixture',researchStatus:'qualified',conflicts:[]}]};
const json=d=>new Response(JSON.stringify(d),{headers:{'Content-Type':'application/json'}});
test('OAuth PKCE/state, resource binding, protected storage and single use callback',async()=>{
 let saved=null,tokenCalls=0;const calls=[];
 const fetchImpl=async(url,options)=>{calls.push({url,options});
  if(url.includes('oauth-protected'))return json({resource,authorization_servers:[issuer]});
  if(url.endsWith('oauth-authorization-server'))return json(metadata);
  if(url.endsWith('/register'))return json({client_id:'fixture-client'});
  if(url.endsWith('/token')){tokenCalls++;return json({access_token:'fixture-access',refresh_token:'fixture-refresh',expires_in:3600,token_type:'Bearer'});}
  if(url===resource){const d=JSON.parse(options.body);return json({jsonrpc:'2.0',id:d.id,result:d.method==='initialize'?{protocolVersion:'2025-06-18'}:d.method==='tools/list'?{tools:[{name:'get_account_info'}]}:d.method==='tools/call'?{structuredContent:{name:'Fixture user'}}:{}});}
  throw new Error('Unexpected destination');
 };
 const client=createWispr({fetchImpl,vault:{load:async()=>saved,save:async x=>saved=x,clear:async()=>saved=null}});
 const connect=await client.connect('http://127.0.0.1:4321/api/wispr/callback'),auth=new URL(connect.authorizationUrl);
 assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.equal(auth.searchParams.get('resource'),resource);
 await assert.rejects(client.callback(new URLSearchParams({state:'forged',code:'fixture'})),/did not match/);assert.equal(tokenCalls,0);
 await client.callback(new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code'}));assert.equal((await client.status()).connected,true);
 const tokenBody=calls.find(x=>x.url.endsWith('/token')).options.body;assert.equal(tokenBody.get('resource'),resource);assert.ok(tokenBody.get('code_verifier').length>=43);
 assert.equal(JSON.stringify(await client.status()).includes('fixture-access'),false);assert.equal(saved.access_token,'fixture-access');
 await assert.rejects(client.callback(new URLSearchParams({state:auth.searchParams.get('state'),code:'fixture-code'})),/did not match/);assert.equal(tokenCalls,1);
 await client.disconnect();assert.equal(saved,null);assert.equal((await client.status()).connected,false);
});
test('share-link allowlist prevents arbitrary network fetch and credentials',()=>{
 for(const url of ['http://127.0.0.1/private','https://notes.wisprflow.ai.evil.test/shared/x','https://x@notes.wisprflow.ai/shared/x','https://notes.wisprflow.ai/other'])assert.throws(()=>wisprLink(url));
 assert.equal(wisprLink('https://notes.wisprflow.ai/shared/test_123?ignored=x'),'https://notes.wisprflow.ai/shared/test_123');
});
test('actual shared-note response shape resolves canonical recording identity by exact share URL',async()=>{
 const link='https://notes.wisprflow.ai/shared/actual-shape';const tools=['resolve_share_link','search_meetings','get_meeting'].map(name=>({name}));
 const client=createWispr({vault:{load:async()=>({access_token:'synthetic',expiresAt:Date.now()+600000}),save:async()=>{},clear:async()=>{}},fetchImpl:async(_,options)=>{
  const d=JSON.parse(options.body);let result={};if(d.method==='initialize')result={protocolVersion:'2025-06-18'};if(d.method==='tools/list')result={tools};
  if(d.method==='tools/call'){const name=d.params.name;result={structuredContent:name==='resolve_share_link'?{title:'Synthetic note',summary:'Fixture',caller_role:'owner',transcript:'Fixture transcript'}:name==='search_meetings'?{meetings:[{id:'wrong-title-match',title:'Synthetic note',share_link:'https://notes.wisprflow.ai/shared/different'},{id:'canonical-recording',title:'Synthetic note',share_link:link}],has_more:false}:{id:'canonical-recording',title:'Synthetic note',start:'2026-10-16T13:00:00Z',end:'2026-10-16T13:01:00Z',share_link:link,transcript:'Fixture transcript',summary:'Fixture'}};}
  return json({jsonrpc:'2.0',id:d.id,result});
 }});
 const result=await client.resolve(link);assert.equal(result.id,'canonical-recording');assert.equal(result.start,'2026-10-16T13:00:00Z');assert.equal(result.transcript,'Fixture transcript');
});
test('disconnect fences a delayed vault load',async()=>{
 let release;const gate=new Promise(r=>release=r);const client=createWispr({vault:{load:async()=>{await gate;return {access_token:'synthetic-stale'};},clear:async()=>{},save:async()=>{}}});
 const status=client.status();await new Promise(r=>setImmediate(r));const disconnected=client.disconnect();release();await disconnected;assert.equal((await status).connected,false);assert.equal((await client.status()).connected,false);
});
test('MCP setup session expiry fails promptly rather than awaiting its own initialization',async()=>{
 for(const failedMethod of ['notifications/initialized','tools/list']){
  const client=createWispr({vault:{load:async()=>({access_token:'synthetic',expiresAt:Date.now()+600000}),save:async()=>{},clear:async()=>{}},fetchImpl:async(_,options)=>{const d=JSON.parse(options.body);if(d.method===failedMethod)return new Response('',{status:404});return new Response(JSON.stringify({id:d.id,result:{protocolVersion:'2025-06-18'}}),{headers:{'Content-Type':'application/json','Mcp-Session-Id':'synthetic-session'}});}});
  await assert.rejects(client.search('2026-10-16','2026-10-17'),/ended the connection during setup/);
 }
});
test('disconnect invalidates a registration response which arrives later',async()=>{
 let release;const gate=new Promise(r=>release=r);let registrationStarted;const started=new Promise(r=>registrationStarted=r);
 const client=createWispr({vault:{load:async()=>null,save:async()=>{},clear:async()=>{}},fetchImpl:async url=>{
  if(url.includes('oauth-protected'))return json({resource,authorization_servers:[issuer]});if(url.endsWith('oauth-authorization-server'))return json(metadata);
  registrationStarted();await gate;return json({client_id:'synthetic'});
 }});
 const connect=client.connect('http://127.0.0.1:4321/api/wispr/callback');await started;await client.disconnect();release();await assert.rejects(connect,/cancelled/);assert.equal((await client.status()).connected,false);
});
test('MCP streaming ignores notifications and matches only requested response',async()=>{
 const r=new Response('event: message\ndata: {"jsonrpc":"2.0","method":"notification"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":4,"result":{"ok":true}}\n\n',{headers:{'Content-Type':'text/event-stream'}});
 assert.deepEqual((await rpcResponse(r,4)).result,{ok:true});
 await assert.rejects(rpcResponse(json({id:9,result:{}}),4),/did not match/);
});
test('Windows vault roundtrip encrypts synthetic credentials without plaintext disk storage',{skip:process.platform!=='win32'},async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'bevamped-vault-')),file=path.join(dir,'vault.dpapi'),vault=windowsVault(file),value={access_token:'SYNTHETIC-not-a-real-token',refresh_token:'SYNTHETIC-refresh'};
 await vault.save(value);const disk=await readFile(file,'utf8');assert.ok(!disk.includes(value.access_token));assert.deepEqual(await vault.load(),value);await vault.clear();assert.equal(await vault.load(),null);
});
async function withDesk(run){
 const dir=await mkdtemp(path.join(tmpdir(),'bevamped-sync-')),dataFile=path.join(dir,'bank.json');await writeFile(dataFile,JSON.stringify(fixture));let ready=false,searchCount=0,hold=null;
 const wisprClient={status:async()=>({connected:true}),resolve:async()=>meeting(),meeting:async()=>{if(hold)await hold;return meeting();},search:async()=>{searchCount++;return {meetings:[meeting()],hasMore:false};},connect:async()=>({authorizationUrl:issuer+'/fixture'}),disconnect:async()=>({connected:false}),callback:async()=>{}};
 const meeting=()=>({id:'recording-1',title:'Synthetic conversation',start:'2026-10-16T13:00:00Z',end:'2026-10-16T13:01:00Z',share_link:'https://notes.wisprflow.ai/shared/fixture',has_transcript:ready,transcript:ready?'Seller: Fixture only. Prospect: Call me later.':'',summary:ready?'Fixture summary':''});
 const analyze=async()=>({method:'ai',summary:'Fixture summary',notes:'Fixture only',outcome:'connected',followUpDate:'',meetingAt:'',nextAction:'Confirm next step',coaching:'Text only.',evidence:['Call me later.'],uncertainties:[],generatedAt:'2026-10-16T13:02:00Z'});
 const desk=await createDesk({port:0,dataFile,stateDir:dir,now:()=> '2026-10-16T13:02:00Z',wisprClient,analyze,analysisInfo:()=>({analysisAvailable:true})}),base=`http://127.0.0.1:${desk.port}`;
 const get=async()=> (await fetch(base+'/api/bootstrap')).json();
 const post=async(route,payload)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const command=async(type,payload)=>{const state=(await get()).state;const r=await post('/api/command',{revision:state.revision,command:{type,payload}});assert.equal(r.status,200,await r.clone().text());return r.json();};
 try{await run({desk,dir,base,get,post,command,setReady:()=>ready=true,setHold:x=>hold=x,searchCount:()=>searchCount});}finally{await desk.close();}
}
test('sync waits for transcript, explicitly selects recording, analyzes and counts only once after confirmation',()=>withDesk(async({get,post,command,setReady,desk,dir})=>{
 await command('approve',{leadId:'one',review:{portfolio:true,presence:true,contact:true}});let b=await command('start_call',{leadId:'one'}),sessionId=b.state.callSessions[0].id;
 let r=await post('/api/wispr/sync',{sessionId}),d=await r.json();assert.equal(d.sync.status,'choose');assert.equal(d.metrics.calls,0);
 r=await post('/api/wispr/sync',{sessionId,meetingId:'recording-1'});d=await r.json();assert.equal(d.sync.status,'waiting');assert.equal(d.state.callSessions[0].material.transcript,'');
 setReady();d=await(await post('/api/wispr/sync',{sessionId})).json();assert.equal(d.sync.status,'review');assert.match(d.state.callSessions[0].material.transcript,/Fixture only/);assert.equal(d.metrics.calls,0);
 d=await(await post('/api/wispr/analyze',{sessionId})).json();assert.equal(d.state.callSessions[0].suggestion.method,'ai');assert.equal(d.metrics.calls,0);
 d=await command('complete_call_session',{sessionId,leadId:'one',outcome:'connected',notes:'Confirmed by user'});assert.equal(d.metrics.calls,1);
 d=await command('complete_call_session',{sessionId,leadId:'one',outcome:'connected'});assert.equal(d.metrics.calls,1);assert.equal(d.state.calls.length,1);
 const backup=await(await fetch(`http://127.0.0.1:${desk.port}/api/export?format=backup`)).json();assert.equal(backup.state.calls[0].material.meetingId,'recording-1');assert.equal(backup.state.callSessions[0].status,'completed');
 await command('approve',{leadId:'two',review:{portfolio:true,presence:true,contact:true}});b=await command('start_call',{leadId:'two'});r=await post('/api/wispr/sync',{sessionId:b.state.callSessions[1].id,notesUrl:'https://notes.wisprflow.ai/shared/fixture'});assert.equal(r.status,400);assert.match((await r.json()).error,/already attached/);
 assert.equal((await get()).metrics.calls,1);assert.ok((await readdir(path.join(dir,'backups'))).length>0);
}));
test('preview has no state effect, internal command rejected and cross-site blocked',()=>withDesk(async({base,get,post})=>{
 const before=(await get()).state;let r=await post('/api/wispr/preview',{notesUrl:'https://notes.wisprflow.ai/shared/fixture'});assert.equal(r.status,200);assert.deepEqual((await get()).state,before);
 r=await post('/api/command',{revision:before.revision,command:{type:'update_call_session',payload:{}}});assert.equal(r.status,403);
 r=await fetch(base+'/api/wispr/connect',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid'},body:'{}'});assert.equal(r.status,403);
 r=await post('/api/wispr/preview',{notesUrl:'http://127.0.0.1/private'});assert.equal(r.status,400);
 r=await fetch(base+'/api/wispr/callback?code=fixture&state=fixture',{headers:{'Sec-Fetch-Site':'cross-site'}});assert.equal(r.status,200);assert.match(await r.text(),/Wispr connected/);
}));
test('restore invalidates pending sync even when the restored session has the same identity',()=>withDesk(async({base,post,command,setReady,setHold,get})=>{
 await command('approve',{leadId:'one',review:{portfolio:true,presence:true,contact:true}});const b=await command('start_call',{leadId:'one'}),sessionId=b.state.callSessions[0].id;
 await command('finish_call_session',{sessionId,leadId:'one'});setReady();await post('/api/wispr/sync',{sessionId,notesUrl:'https://notes.wisprflow.ai/shared/fixture'});
 const backup=await(await fetch(base+'/api/export?format=backup')).json();let release;setHold(new Promise(r=>release=r));
 const pending=post('/api/wispr/sync',{sessionId});await new Promise(r=>setTimeout(r,40));const revision=(await get()).state.revision;
 const restored=await post('/api/restore',{revision,backup});assert.equal(restored.status,200);const after=(await get()).state;
 release();const response=await pending;assert.equal(response.status,400);assert.match((await response.json()).error,/restored/);assert.deepEqual((await get()).state,after);
}));
test('cancel while retrieval is pending prevents a late import',()=>withDesk(async({post,command,setReady,setHold,get})=>{
 await command('approve',{leadId:'one',review:{portfolio:true,presence:true,contact:true}});const b=await command('start_call',{leadId:'one'}),sessionId=b.state.callSessions[0].id;
 await command('finish_call_session',{sessionId,leadId:'one'});setReady();let release;setHold(new Promise(resolve=>release=resolve));
 const pending=post('/api/wispr/sync',{sessionId,notesUrl:'https://notes.wisprflow.ai/shared/fixture'}); // resolve does not hold: use explicit meeting instead
 const first=await pending;assert.equal(first.status,200);
 const realPending=post('/api/wispr/sync',{sessionId});await new Promise(r=>setTimeout(r,40));await command('cancel_call',{sessionId,leadId:'one'});release();const r=await realPending;assert.equal(r.status,400);assert.equal((await get()).state.callSessions[0].status,'cancelled');assert.equal((await get()).metrics.calls,0);
}));
