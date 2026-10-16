import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {windowsVault} from './wispr.mjs';

const API='https://www.googleapis.com/calendar/v3';
const TOKEN='https://oauth2.googleapis.com/token';
export const CALENDAR_SCOPES=['https://www.googleapis.com/auth/calendar.events.owned','https://www.googleapis.com/auth/calendar.calendarlist.readonly'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const error=message=>new Error(message);
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function readJSON(response){
  const reader=response.body?.getReader();if(!reader)throw error('Google returned an empty response.');
  let text='',size=0;const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024)throw error('Google returned too much data.');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}
  finally{await reader.cancel().catch(()=>{});}
}
export function calendarPlan({call,lead,testOnly=false,durationMinutes=30,reminders=[{method:'email',minutes:1440},{method:'popup',minutes:15}]}){
  if(call?.outcome!=='meeting_booked'||!call.meetingAt||!Number.isFinite(Date.parse(call.meetingAt)))throw error('Save a booked meeting with an agreed date and time first.');
  if(!Number.isInteger(durationMinutes)||durationMinutes<5||durationMinutes>240)throw error('Choose a meeting duration between 5 and 240 minutes.');
  if(!Array.isArray(reminders)||reminders.length>5||reminders.some(r=>!['email','popup'].includes(r?.method)||!Number.isInteger(r.minutes)||r.minutes<0||r.minutes>40320))throw error('Choose up to five valid calendar reminders.');
  const unique=[...new Map(reminders.map(r=>[`${r.method}:${r.minutes}`,{method:r.method,minutes:r.minutes}])).values()].sort((a,b)=>a.method.localeCompare(b.method)||a.minutes-b.minutes);
  const key=hash(`bevamped-bolt:call:${call.id}`),id='b'+key;
  const resource={id,summary:`BEVAMPED · ${String(lead.name).slice(0,160)} · second call`,description:'Meeting agreed and confirmed in BOLT. Open BOLT for your private research and call notes.',start:{dateTime:new Date(call.meetingAt).toISOString(),timeZone:'Africa/Lagos'},end:{dateTime:new Date(Date.parse(call.meetingAt)+durationMinutes*60000).toISOString(),timeZone:'Africa/Lagos'},reminders:{useDefault:false,overrides:unique},visibility:'private',transparency:'opaque',extendedProperties:{private:{boltKey:key}}};
  const fingerprint=hash(JSON.stringify(resource));resource.extendedProperties.private.boltFingerprint=fingerprint;
  if(testOnly){resource.summary='BOLT TEST · Calendar connection and reminders';resource.description='Private BOLT connection test. This is not a prospect meeting and does not count as a call or booking.';resource.extendedProperties.private.boltFingerprint=hash(JSON.stringify({...resource,extendedProperties:{private:{boltKey:key}}}));}
  return {key,id,fingerprint:resource.extendedProperties.private.boltFingerprint,resource,durationMinutes};
}
function safeEventLink(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.google.com','calendar.google.com'].includes(u.hostname)?u.href:'';}catch{return '';}}
function remindersMatch(a,b){const normalize=x=>JSON.stringify({useDefault:!!x?.useDefault,overrides:(x?.overrides||[]).map(r=>({method:r.method,minutes:r.minutes})).sort((r,s)=>r.method.localeCompare(s.method)||r.minutes-s.minutes)});return normalize(a)===normalize(b);}

// Credential and scheduling records are deliberately separate from restorable call history.
// A stable provider event ID also reconciles retries after a timeout or lost local ledger.
export async function createCalendar({stateDir,fetchImpl=fetch,vault=windowsVault(path.join(stateDir,'google-calendar.dpapi'),'Google Calendar'),clock=()=>Date.now()}={}){
  const ledgerFile=path.join(stateDir,'calendar-jobs.json');let jobs={};
  try{jobs=JSON.parse(await readFile(ledgerFile,'utf8'));if(!jobs||Array.isArray(jobs)||typeof jobs!=='object')throw error('Invalid calendar ledger.');}catch(e){if(e.code!=='ENOENT')throw error('The calendar scheduling record is unreadable. It was preserved; restore it before scheduling.');}
  let saved,loading,pending,epoch=0,refreshing,storageChain=Promise.resolve(),ledgerChain=Promise.resolve();const locks=new Set();
  const storage=fn=>{const p=storageChain.then(fn);storageChain=p.catch(()=>{});return p;};
  const check=g=>{if(g!==epoch)throw error('Google Calendar connection changed. Reconnect or refresh before continuing.');};
  async function load(){if(saved===undefined){loading ||= storage(()=>vault.load()).then(x=>{saved=x||{};}).finally(()=>loading=null);await loading;}return saved;}
  async function save(value,g){await storage(async()=>{check(g);await vault.save(value);check(g);saved=value;});}
  async function record(key,value){const p=ledgerChain.then(async()=>{const next={...jobs,[key]:value};const temp=ledgerFile+'.pending';await writeFile(temp,JSON.stringify(next,null,2),'utf8');await rename(temp,ledgerFile);jobs=next;});ledgerChain=p.catch(()=>{});await p;}
  async function recordConfirmed(key,value){try{await record(key,value);}catch{throw error('Google has the meeting, but BOLT could not save its local calendar confirmation. Check Google Calendar and use Check / retry to reconcile the same event. Your call is still saved.');}}
  const request=(url,options={})=>fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(25000)});
  async function token(fields,config){const r=await request(TOKEN,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...fields,client_id:config.clientId,client_secret:config.clientSecret})});if(!r.ok){await r.body?.cancel();throw error('Google authorization expired or was declined. Connect Google Calendar again.');}const t=await readJSON(r);if(typeof t.access_token!=='string'||String(t.token_type).toLowerCase()!=='bearer')throw error('Google returned an unsupported authorization response.');return t;}
  async function access(g){await load();check(g);const connection=saved.connection;if(!connection)throw error('Connect Google Calendar first.');if(connection.expiresAt>clock()+60000)return connection.accessToken;
    if(!connection.refreshToken)throw error('Google authorization expired. Connect again.');
    if(!refreshing)refreshing=(async()=>{const t=await token({grant_type:'refresh_token',refresh_token:connection.refreshToken},saved.config);check(g);await save({...saved,connection:{...connection,accessToken:t.access_token,refreshToken:t.refresh_token||connection.refreshToken,expiresAt:clock()+(Number(t.expires_in)||3600)*1000}},g);return t.access_token;})().finally(()=>refreshing=null);
    return refreshing;
  }
  async function api(route,{method='GET',body,headers={},allow404=false,tokenValue,g=epoch}={}){const key=tokenValue||await access(g);check(g);const r=await request(API+route,{method,headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
    if(allow404&&r.status===404){await r.body?.cancel();return null;}
    if(!r.ok){await r.body?.cancel();const e=error(r.status===401?'Google sign-in has expired. Connect again.':r.status===403?'Google Calendar denied access. Check that the Calendar API is enabled and both requested permissions are approved.':r.status===409?'This calendar event already exists. Refresh and try again to reconcile it.':r.status===412?'The calendar event changed elsewhere. Review it and retry.':'Google Calendar is unavailable. Your call remains saved; retry scheduling later.');e.status=r.status;throw e;}return readJSON(r);
  }
  async function primary(tokenValue,g){let page='';for(let n=0;n<5;n++){const result=await api('/users/me/calendarList?maxResults=250'+(page?'&pageToken='+encodeURIComponent(page):''),{tokenValue,g});const p=result.items?.find(x=>x.primary&&x.accessRole==='owner'&&typeof x.id==='string'&&x.id.includes('@'));if(p)return {id:p.id,name:p.summary||p.id};page=result.nextPageToken;if(!page)break;}throw error('Google did not return an owned primary calendar. Check which account you connected.');}
  async function status(){await load();return {configured:!!saved.config,connected:!!saved.connection,account:saved.connection?.account||'',calendarName:saved.connection?.calendarName||'',jobs:Object.values(jobs)};}
  async function configure(input){const c=input?.installed;if(!c||typeof c.client_id!=='string'||!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(c.client_id)||typeof c.client_secret!=='string'||!c.client_secret.trim()||c.client_secret.length>500)throw error('Choose the Google OAuth JSON downloaded for a Desktop app. Web and service-account credentials are not supported.');
    const g=++epoch;pending=null;await load();await save({config:{clientId:c.client_id,clientSecret:c.client_secret}},g);return status();}
  async function connect(redirectUri){await load();if(!saved.config)throw error('Complete the one-time Google app setup first.');const u=new URL(redirectUri);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/api/calendar/callback')throw error('Invalid calendar callback.');const g=++epoch;const state=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');pending={state,verifier,redirectUri,expires:clock()+300000,g,config:{...saved.config}};
    const destination=new URL('https://accounts.google.com/o/oauth2/v2/auth');destination.search=new URLSearchParams({client_id:saved.config.clientId,redirect_uri:redirectUri,response_type:'code',scope:CALENDAR_SCOPES.join(' '),state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'offline',prompt:'consent select_account'});return {authorizationUrl:destination.href};}
  async function callback(params){const p=pending;if(!p||p.expires<clock()||!equal(params.get('state'),p.state))throw error('Google sign-in expired or did not match this request. Start Connect Google Calendar again.');pending=null;check(p.g);if(params.get('error'))throw error('Google authorization was declined. No calendar connection was changed.');if(!params.get('code'))throw error('Google did not supply an authorization code.');
    const t=await token({grant_type:'authorization_code',code:params.get('code'),redirect_uri:p.redirectUri,code_verifier:p.verifier},p.config);check(p.g);const scopes=String(t.scope||'').split(' ');if(!CALENDAR_SCOPES.every(s=>scopes.includes(s)))throw error('Approve both calendar permissions before connecting BOLT.');const account=await primary(t.access_token,p.g);check(p.g);await save({config:p.config,connection:{accessToken:t.access_token,refreshToken:t.refresh_token||'',expiresAt:clock()+(Number(t.expires_in)||3600)*1000,account:account.id,calendarName:account.name}},p.g);return status();}
  async function disconnect(){const g=++epoch;pending=null;await load();await save({config:saved.config},g);return status();}
  async function conflicts(plan,g){const c=saved.connection.account;let page='',items=[];for(let n=0;n<5;n++){const q=new URLSearchParams({timeMin:plan.resource.start.dateTime,timeMax:plan.resource.end.dateTime,singleEvents:'true',maxResults:'250',...(page?{pageToken:page}:{})});const result=await api(`/calendars/${encodeURIComponent(c)}/events?${q}`,{g});if(!Array.isArray(result.items))throw error('Google returned an unreadable availability response.');items.push(...result.items.filter(x=>x.id!==plan.id&&x.status!=='cancelled'&&x.transparency!=='transparent'&&!x.attendees?.some(a=>a.self&&a.responseStatus==='declined')).map(x=>({title:String(x.summary||'Busy').slice(0,160),start:x.start?.dateTime||x.start?.date||'',end:x.end?.dateTime||x.end?.date||''})));page=result.nextPageToken;if(!page)return items;}throw error('Could not finish checking calendar availability. No meeting was scheduled.');}
  async function schedule(input,stillValid=()=>{}){
    const plan=calendarPlan(input);if(locks.has(plan.key))throw error('This meeting is already being scheduled. Wait for the current request.');locks.add(plan.key);const g=epoch;
    try{await access(g);const account=saved.connection.account;if(input.account!==account)throw error('The connected calendar account changed. Review it before scheduling.');
      const previous=jobs[plan.key];if(previous&&previous.account!==account)throw error('This meeting was already associated with a different calendar account. Open that calendar before creating another event.');
      const route=`/calendars/${encodeURIComponent(account)}/events`,remote=await api(route+'/'+plan.id,{allow404:true,g});check(g);stillValid();
      if(remote&&(remote.status==='cancelled'||remote.extendedProperties?.private?.boltKey!==plan.key))throw error('This event was removed or does not belong to BOLT. Review Google Calendar before scheduling again.');
      const matches=remote&&remote.extendedProperties?.private?.boltFingerprint===plan.fingerprint&&Date.parse(remote.start?.dateTime)===Date.parse(plan.resource.start.dateTime)&&Date.parse(remote.end?.dateTime)===Date.parse(plan.resource.end.dateTime)&&remote.summary===plan.resource.summary&&remote.visibility==='private'&&(remote.transparency||'opaque')==='opaque'&&remindersMatch(remote.reminders,plan.resource.reminders);
      const base={key:plan.key,callId:input.call.id,leadId:input.lead.id,account,eventId:plan.id,meetingAt:plan.resource.start.dateTime,durationMinutes:plan.durationMinutes,fingerprint:plan.fingerprint,testOnly:input.testOnly===true,updatedAt:new Date(clock()).toISOString()};
      if(matches){await recordConfirmed(plan.key,{...base,status:'scheduled',url:safeEventLink(remote.htmlLink)});return {status:'scheduled',reconciled:true,job:jobs[plan.key]};}
      const clashes=await conflicts(plan,g);check(g);stillValid();if(clashes.length&&!input.allowConflict)return {status:'conflict',conflicts:clashes};
      if(remote?.attendees?.length)throw error('This event now has attendees. Update it directly in Google Calendar to avoid changing invitations.');
      await record(plan.key,{...base,status:'pending',url:safeEventLink(remote?.htmlLink)});check(g);stillValid();
      let event;
      try{event=await api(route+(remote?'/'+plan.id:'')+'?sendUpdates=none',{method:remote?'PATCH':'POST',body:plan.resource,headers:remote?.etag?{'If-Match':remote.etag}:{},g});}
      catch(e){await record(plan.key,{...base,status:'needs_check',url:safeEventLink(remote?.htmlLink)}).catch(()=>{});throw error(`${e.message} Scheduling is unconfirmed. Use Check / retry to reconcile the same event before trying again.`);}
      if(event.id!==plan.id||event.extendedProperties?.private?.boltKey!==plan.key||Date.parse(event.start?.dateTime)!==Date.parse(plan.resource.start.dateTime)||Date.parse(event.end?.dateTime)!==Date.parse(plan.resource.end.dateTime)||event.visibility!=='private'||!remindersMatch(event.reminders,plan.resource.reminders)){await record(plan.key,{...base,status:'needs_check'}).catch(()=>{});throw error('Google returned unexpected event details. Scheduling is unconfirmed. Check the calendar and use Check / retry to reconcile it.');}
      await recordConfirmed(plan.key,{...base,status:'scheduled',url:safeEventLink(event.htmlLink)});return {status:'scheduled',job:jobs[plan.key]};
    }finally{locks.delete(plan.key);}
  }
  async function runTest({account,confirmed}={}){if(confirmed!==true)throw error('Confirm the live calendar test first.');const id='calendar-test-'+hash(String(account)),old=Object.values(jobs).find(j=>j.callId===id&&j.testOnly);const start=old&&Date.parse(old.meetingAt)>clock()?Date.parse(old.meetingAt):Math.ceil((clock()+10*60000)/60000)*60000;
    for(let i=0;i<6;i++){const result=await schedule({call:{id,outcome:'meeting_booked',meetingAt:new Date(start+i*5*60000).toISOString()},lead:{id:'calendar-test',name:'BOLT test'},testOnly:true,account,durationMinutes:5,reminders:[{method:'popup',minutes:2},{method:'email',minutes:2}]});if(result.status==='scheduled')return result;}
    throw error('No free five-minute test slot was found in the next forty minutes. No test was scheduled.');
  }
  return {status,configure,connect,callback,disconnect,schedule,runTest};
}
