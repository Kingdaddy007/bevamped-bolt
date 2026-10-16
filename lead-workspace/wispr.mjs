import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';

const RESOURCE='https://api.wisprflow.ai/connect/mcp';
const ISSUER='https://mcp-auth.wisprflow.com';
const VERSION='2025-06-18';
const LIMIT=2*1024*1024;
const fail=message=>new Error(message);

// Fixed script, secrets only on stdin; Windows protects data for the current user.
function protect(input,decrypt=false,label='Wispr'){
  if(process.platform!=='win32')throw fail(`Persistent ${label} sign-in requires Windows credential protection.`);
  const code=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $s=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($s); $r=[Security.Cryptography.ProtectedData]::${decrypt?'Unprotect':'Protect'}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r));`;
  return new Promise((resolve,reject)=>{
    const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(code,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{p.kill();reject(fail('Windows credential protection timed out.'));},15000);
    p.stdout.on('data',b=>{output+=b;if(output.length>LIMIT)p.kill();});p.stderr.resume();p.on('error',()=>{clearTimeout(timer);reject(fail('Windows credential protection is unavailable.'));});
    p.on('close',n=>{clearTimeout(timer);n===0?resolve(Buffer.from(output.trim(),'base64')):reject(fail(`Could not unlock the ${label} connection. Connect again on this Windows account.`));});p.stdin.on('error',()=>{});p.stdin.end(Buffer.from(input).toString('base64'));
  });
}
export function windowsVault(filename,label='Wispr'){
  return {
    async load(){try{return JSON.parse((await protect(Buffer.from((await readFile(filename,'utf8')).trim(),'base64'),true,label)).toString('utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},
    async save(value){const encrypted=await protect(Buffer.from(JSON.stringify(value)),false,label);const temp=filename+'.pending';await writeFile(temp,encrypted.toString('base64'),{mode:0o600});await rename(temp,filename);},
    async clear(){try{await unlink(filename);}catch(e){if(e.code!=='ENOENT')throw e;}}
  };
}
export function wisprLink(value){
  if(typeof value!=='string'||value.length>3000)throw fail('Paste a Wispr shared-note link.');
  let u;try{u=new URL(value.trim());}catch{throw fail('Paste the complete Wispr shared-note link.');}
  if(u.origin!=='https://notes.wisprflow.ai'||u.username||u.password||!/^\/shared\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))throw fail('Use a https://notes.wisprflow.ai/shared/… link.');
  u.search='';u.hash='';return u.href;
}
async function boundedText(response){
  let result='',size=0;const reader=response.body?.getReader();if(!reader)return '';
  const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT)throw fail('Wispr returned too much data. Nothing was imported.');result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}finally{await reader.cancel().catch(()=>{});}
}
export async function rpcResponse(response,id){
  if(response.headers.get('content-type')?.includes('text/event-stream')){
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT)throw fail('Wispr response exceeded the import limit.');buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');let n;while((n=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,n);buffer=buffer.slice(n+2);const data=event.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;let m;try{m=JSON.parse(data);}catch{continue;}if(m.id===id)return m;}}}finally{await reader.cancel().catch(()=>{});}throw fail('Wispr closed the response before returning the result.');
  }
  let data;try{data=JSON.parse(await boundedText(response));}catch(e){if(e.message.includes('too much'))throw e;throw fail('Wispr returned an unreadable response.');}
  if(data.id!==id)throw fail('Wispr response did not match the request.');return data;
}
function unpack(result){
  if(result?.isError)throw fail('Wispr could not read this note. Check access in Wispr and try again.');
  if(result?.structuredContent)return result.structuredContent;
  const text=(result?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');try{return JSON.parse(text);}catch{throw fail('Wispr returned an unsupported note format.');}
}
export function createWispr({stateDir,fetchImpl=fetch,vault=windowsVault(path.join(stateDir,'wispr-connection.dpapi')),clock=()=>Date.now()}={}){
  let saved=null,loaded=false,pending=null,authLoading=null,sessionId='',version=VERSION,tools=[],rpcId=0,account=null,epoch=0,vaultChain=Promise.resolve(),loading=null;
  const vaultOperation=fn=>{const operation=vaultChain.then(fn);vaultChain=operation.catch(()=>{});return operation;};
  const saveConnection=(value,generation)=>vaultOperation(async()=>{if(generation!==epoch)throw fail('Wispr was disconnected.');await vault.save(value);if(generation!==epoch)throw fail('Wispr was disconnected.');});
  const request=async(url,options={})=>fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  async function load(){if(!loaded){if(!loading){const generation=epoch;loading=vaultOperation(()=>vault.load()).then(value=>{if(generation===epoch){saved=value;loaded=true;}}).finally(()=>loading=null);}await loading;}return saved;}
  async function metadata(){const r=await request('https://api.wisprflow.ai/.well-known/oauth-protected-resource/connect/mcp');if(!r.ok)throw fail('Cannot read Wispr connection settings. Try again later.');const resource=JSON.parse(await boundedText(r));if(resource.resource!==RESOURCE||!resource.authorization_servers?.includes(ISSUER))throw fail('Wispr authorization settings changed. Connection stopped.');const ar=await request(ISSUER+'/.well-known/oauth-authorization-server');if(!ar.ok)throw fail('Wispr sign-in is unavailable.');const a=JSON.parse(await boundedText(ar));if(a.issuer!==ISSUER||!a.code_challenge_methods_supported?.includes('S256'))throw fail('Wispr sign-in does not support the required protection.');for(const key of ['authorization_endpoint','token_endpoint','registration_endpoint'])if(new URL(a[key]).origin!==ISSUER)throw fail('Unexpected Wispr sign-in destination.');return a;}
  async function token(body,a){const r=await request(a.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...body,resource:RESOURCE})});if(!r.ok)throw fail('Wispr sign-in expired or was declined. Connect Wispr again.');const t=JSON.parse(await boundedText(r));if(typeof t.access_token!=='string'||String(t.token_type).toLowerCase()!=='bearer')throw fail('Wispr returned an unsupported sign-in response.');return {access_token:t.access_token,refresh_token:t.refresh_token||body.refresh_token,expiresAt:clock()+(Number(t.expires_in)||3600)*1000};}
  async function access(){await load();if(!saved?.access_token)throw fail('Connect Wispr in Settings first.');if(saved.expiresAt>clock()+60000)return saved.access_token;if(!saved.refresh_token)throw fail('Wispr access expired. Connect again.');if(!authLoading){const generation=epoch,connection=saved;authLoading=(async()=>{const a=await metadata();const t=await token({grant_type:'refresh_token',refresh_token:connection.refresh_token,client_id:connection.client_id},a);if(generation!==epoch)throw fail('Wispr was disconnected.');saved={...connection,...t};await saveConnection(saved,generation);return saved.access_token;})().finally(()=>authLoading=null);}return authLoading;}
  async function rpc(method,params,notification=false,retry=true){
    const key=await access(),id=++rpcId;const r=await request(RESOURCE,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(sessionId?{'Mcp-Session-Id':sessionId,'MCP-Protocol-Version':version}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,...(params?{params}:{})})});
    if(r.status===401){await r.body?.cancel();if(saved)saved.expiresAt=0;if(retry&&saved?.refresh_token){await access();return rpc(method,params,notification,false);}throw fail('Wispr access expired. Reconnect in Settings.');}
    if(r.status===404&&sessionId&&retry){await r.body?.cancel();sessionId='';tools=[];if(initializing)throw fail('Wispr ended the connection during setup. Try Connect again.');await initialize();return rpc(method,params,notification,false);}
    if(!r.ok){await r.body?.cancel();throw fail(r.status===429?'Wispr is busy. Wait a minute before retrying.':r.status===403?'Wispr denied access. Check your account permissions.':`Wispr is temporarily unavailable (${r.status}). Try again.`);}
    if(notification){await r.body?.cancel();return;}
    const m=await rpcResponse(r,id);if(m.error)throw fail('Wispr could not complete this request. Reconnect or try again later.');if(method==='initialize'){sessionId=r.headers.get('mcp-session-id')||'';version=m.result?.protocolVersion||VERSION;}return m.result;
  }
  let initializing=null;
  async function initialize(){if(tools.length)return;if(initializing)return initializing;initializing=(async()=>{await rpc('initialize',{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'Bevamped Lead Desk',version:'1.1.0'}});await rpc('notifications/initialized',null,true);let list=await rpc('tools/list',{});tools=list.tools||[];if(!tools.length)throw fail('Wispr did not expose meeting tools for this account.');})().finally(()=>initializing=null);return initializing;}
  async function call(name,args){await initialize();const tool=tools.find(t=>t.name===name)||tools.find(t=>t.name.endsWith('_'+name));if(!tool)throw fail(`Wispr does not currently provide ${name.replaceAll('_',' ')} for this connection.`);return unpack(await rpc('tools/call',{name:tool.name,arguments:args}));}
  async function fullMeeting(method,args){
    let first=null,pieces=[],offset=0;
    for(let page=0;page<8;page++){
      const result=await call(method,{...args,view_transcript:{char_limit:40000,start_char:offset}});first??=result;
      const transcript=result.transcript;if(typeof transcript!=='string'||!transcript.trim())return {...first,transcript:'',transcriptAccess:result.transcript_access||''};
      // Provider advertises continuation offsets in an appended marker. Never silently accept truncated text.
      const marker=transcript.match(/\n?\[?[^\n]*(?:truncated|continued|more transcript)[^\n]*(?:start_char|offset)\s*[=:]\s*(\d+)[^\n]*$/i);
      if(!marker&&/\btruncated\b|\bstart_char\s*[=:]/i.test(transcript.slice(-800)))throw fail('This transcript needs another page. Import stopped rather than saving incomplete evidence.');
      pieces.push(marker?transcript.slice(0,marker.index):transcript);if(pieces.join('').length>200000)throw fail('This transcript exceeds 200,000 characters. Use a shorter call excerpt manually.');
      if(!marker)return {...first,transcript:pieces.join('')};const next=Number(marker[1]);if(next<=offset)throw fail('Wispr returned an invalid transcript continuation.');offset=next;
    }
    throw fail('Transcript pagination exceeded the import limit. Nothing was imported.');
  }
  return {
    async status(){try{await load();return {connected:!!saved?.access_token,account:account?.name||null};}catch{return {connected:false,error:'Saved Wispr access could not be unlocked. Connect again.'};}},
    async connect(redirectUri){
      const generation=epoch;
      if(!/^http:\/\/127\.0\.0\.1:\d+\/api\/wispr\/callback$/.test(redirectUri))throw fail('Invalid local sign-in callback.');
      const a=await metadata(),r=await request(a.registration_endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Bevamped Lead Desk',redirect_uris:[redirectUri],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});if(!r.ok)throw fail('Wispr could not register this desk. Try Connect again.');const client=JSON.parse(await boundedText(r));if(typeof client.client_id!=='string')throw fail('Wispr did not return a client identifier.');
      if(generation!==epoch)throw fail('This connection was cancelled.');const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');pending={state,verifier,redirectUri,client_id:client.client_id,a,expiresAt:clock()+5*60000};
      const u=new URL(a.authorization_endpoint);u.search=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirectUri,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',scope:'openid offline_access',resource:RESOURCE}).toString();return {authorizationUrl:u.href};
    },
    async callback(query){
      const p=pending;const candidate=query.get('state')||'';if(!p||p.expiresAt<clock()||candidate.length!==p.state.length||!timingSafeEqual(Buffer.from(candidate),Buffer.from(p.state)))throw fail('This sign-in attempt expired or did not match. Return to the desk and connect again.');pending=null;
      if(query.get('error')||!query.get('code'))throw fail('Wispr authorization was cancelled. Return to the desk to try again.');const generation=epoch;const t=await token({grant_type:'authorization_code',code:query.get('code'),redirect_uri:p.redirectUri,client_id:p.client_id,code_verifier:p.verifier},p.a);if(generation!==epoch)throw fail('This connection was cancelled.');const previous=saved;saved={client_id:p.client_id,...t};loaded=true;sessionId='';tools=[];
      try{account=await call('get_account_info',{});if(generation!==epoch)throw fail('This connection was cancelled.');await saveConnection(saved,generation);return {connected:true,account:account?.name||null};}catch(e){saved=generation===epoch?previous:null;sessionId='';tools=[];account=null;throw e;}
    },
    async disconnect(){epoch++;pending=null;saved=null;loaded=true;account=null;tools=[];sessionId='';await vaultOperation(()=>vault.clear());return {connected:false};},
    async search(since,until){const d=await call('search_meetings',{since,until,limit:25});return {meetings:Array.isArray(d.meetings)?d.meetings:[],hasMore:!!d.has_more};},
    async meeting(id){if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,200}$/.test(id))throw fail('Invalid Wispr recording ID.');return fullMeeting('get_meeting',{meeting_id:id});},
    async resolve(link){
      const normalized=wisprLink(link),note=await fullMeeting('resolve_share_link',{url:normalized});
      // Shared-note responses have no recording ID or call time. Resolve by the exact
      // returned share URL in the account listing, never by a guessed title/identity.
      if(note.id)return {...note,share_link:normalized};
      let cursor;
      for(let page=0;page<8;page++){
        const result=await call('search_meetings',{...(note.title?{query:note.title}:{}),limit:25,...(cursor?{cursor}:{})});
        const match=(result.meetings||[]).find(m=>{try{return m.share_link&&wisprLink(m.share_link)===normalized;}catch{return false;}});
        if(match){const recording=await fullMeeting('get_meeting',{meeting_id:match.id});return {...recording,share_link:normalized};}
        if(!result.has_more||!result.next_cursor)break;cursor=result.next_cursor;
      }
      return {...note,share_link:normalized};
    }
  };
}
export function meetingMaterial(meeting,now=new Date().toISOString()){
  if(typeof meeting?.id!=='string')throw fail('Wispr did not return a recording identity.');
  const transcript=typeof meeting.transcript==='string'?meeting.transcript:'';
  if(transcript.length>200000||String(meeting.summary||'').length>20000)throw fail('This recording exceeds the supported import size.');
  return {provider:'wispr_flow',meetingId:meeting.id,title:String(meeting.title||'Untitled recording').slice(0,500),notesUrl:meeting.share_link?wisprLink(meeting.share_link):'',transcript,summary:String(meeting.summary||''),coaching:'',startedAt:meeting.start||'',endedAt:meeting.end||'',importedAt:now,updatedAt:now};
}
