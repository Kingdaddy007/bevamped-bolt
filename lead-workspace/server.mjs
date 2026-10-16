import http from 'node:http';
import { readFile, writeFile, mkdir, rename, copyFile, stat, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { initialState, applyCommand, validateState, leadState, localDate, dayMetrics } from './domain.mjs';
import {createWispr,meetingMaterial,wisprLink} from './wispr.mjs';
import {analysisStatus,analyzeCall} from './call-analysis.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 64 * 1024 * 1024;
const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ico':'image/x-icon'};
const csvCell = x => {const value=String(x??'');const safe=typeof x==='string'&&/^[=+@\-\t\r]/.test(value)?"'"+value:value;return `"${safe.replaceAll('"','""')}"`;};
export async function createDesk({ port = Number(process.env.PORT || 4318), dataFile = path.join(ROOT,'data','central-leads.json'), stateDir = process.env.BEVAMPED_STATE_DIR || path.join(ROOT,'saved'), now = () => new Date().toISOString(), wisprClient, analyze = analyzeCall, analysisInfo = analysisStatus } = {}) {
  const dataset = JSON.parse(await readFile(dataFile,'utf8').then(s=>s.replace(/^\uFEFF/,'')));
  if(dataset.schemaVersion!==1 || !Array.isArray(dataset.leads) || !dataset.leads.length)throw new Error('The reconciled lead bank is missing or incompatible.');
  if(new Set(dataset.leads.map(l=>l.id)).size!==dataset.leads.length || dataset.leads.some(l=>!/^[-a-zA-Z0-9_]+$/.test(l.id)))throw new Error('The bank contains invalid or duplicate lead IDs.');
  const datasetHash=createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  await mkdir(stateDir,{recursive:true});
  const backupsDir=path.join(stateDir,'backups');await mkdir(backupsDir,{recursive:true});
  const stateFile=path.join(stateDir,'workspace-state.json');
  let state;
  try {state=JSON.parse((await readFile(stateFile,'utf8')).replace(/^\uFEFF/,''));validateState(state,dataset);}
  catch(e){if(e.code!=='ENOENT')throw new Error(`Saved workspace could not be read. Your file was preserved. ${e.message}`);state=initialState(now());await writeFile(stateFile,JSON.stringify(state,null,2),'utf8');}
  let chain=Promise.resolve();
  let lastSavedAt=state.updatedAt;
  const persist=async next=>{
    const before=state;
    const stamp=now().replace(/[:.]/g,'-');
    const backup=path.join(backupsDir,`${stamp}-r${before.revision}-${randomBytes(3).toString('hex')}.json`);
    await copyFile(stateFile,backup);
    const temporary=path.join(stateDir,`.pending-${randomBytes(8).toString('hex')}.json`);
    await writeFile(temporary,JSON.stringify(next,null,2),'utf8');
    await rename(temporary,stateFile);
    state=next;lastSavedAt=next.updatedAt;
  };
  const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  const body=async req=>{let raw='';let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY)throw new Error('This file is too large to import.');raw+=chunk;}try{return JSON.parse(raw);}catch{throw new Error('The request is not valid JSON.');}};
  const payload=()=>({dataset,state,today:localDate(now()),metrics:dayMetrics(state,localDate(now())),storage:{lastSavedAt,location:stateDir,backupMode:'before every saved change'},datasetHash});
  const wispr=wisprClient||createWispr({stateDir});
  const sessionJobs=new Set();let previewBusy=false,workspaceGeneration=0;
  const commit=(command,generation=workspaceGeneration)=>{
    const operation=chain.then(async()=>{if(generation!==workspaceGeneration)throw new Error('The workspace was restored during this request. Retry from the restored state.');const next=applyCommand(state,dataset,command,now());await persist(next);return payload();});
    chain=operation.catch(()=>{});return operation;
  };
  const getSession=id=>{const s=(state.callSessions||[]).find(s=>s.id===id);if(!s)throw new Error('Call session not found.');return s;};
  const openSession=id=>{const s=getSession(id);if(['completed','cancelled'].includes(s.status))throw new Error('This call session has already ended. Refresh the workspace.');return s;};
  async function syncCall(input){
    const generation=workspaceGeneration;
    let s=openSession(input.sessionId);
    if(s.status==='active'){await commit({type:'finish_call_session',payload:{sessionId:s.id,leadId:s.leadId}},generation);s=openSession(s.id);}
    const update=async p=>commit({type:'update_call_session',payload:{sessionId:s.id,leadId:s.leadId,...p}},generation);
    // The user chooses a recording even when only one lies in the time window.
    const since=new Date(Date.parse(s.startedAt)-120000).toISOString(),until=new Date(Date.parse(s.endedAt)+120000).toISOString();
    let meeting;
    if(input.notesUrl){wisprLink(input.notesUrl);meeting=await wispr.resolve(input.notesUrl);}
    else if(s.meetingId)meeting=await wispr.meeting(s.meetingId);
    else {
      const result=await wispr.search(since,until);
      const available=result.meetings.filter(m=>m&&typeof m.id==='string'&&Number.isFinite(Date.parse(m.start))&&Date.parse(m.start)<=Date.parse(until)&&(!m.end||Date.parse(m.end)>=Date.parse(since))).filter(m=>!(state.callSessions||[]).some(x=>x.id!==s.id&&x.status!=='cancelled'&&x.meetingId===m.id)&&!state.calls.some(c=>c.material?.meetingId===m.id));
      if(input.meetingId){if(!available.some(m=>m.id===input.meetingId))throw new Error('Choose a recording from this call’s results, or paste its Wispr link.');meeting=await wispr.meeting(input.meetingId);}
      else if(available.length)return {...payload(),sync:{status:'choose',message:result.hasMore?'More recordings exist. Choose from these or paste the exact Wispr link.':'Confirm which recording belongs to this lead.',candidates:available.map(m=>({id:m.id,title:m.title||'Untitled recording',start:m.start,end:m.end,has_transcript:m.has_transcript}))}};
      else return {...payload(),sync:{status:'waiting',message:'No matching recording is available yet. Stop Wispr, then wait for it to finish processing. You can also paste the exact note link.'}};
    }
    s=openSession(s.id);
    const material=meetingMaterial(meeting,now());
    if(s.meetingId&&material.meetingId!==s.meetingId)throw new Error('This call already has a different recording. Cancel it before starting a replacement session.');
    if(!material.transcript.trim()){
      await update({status:'waiting',meetingId:material.meetingId,material});
      return {...payload(),sync:{status:'waiting',message:meeting.transcriptAccess?'Wispr has not granted transcript access. Check this note’s access in Wispr; a link alone may provide only its summary.':'Recording found. Its transcript is not ready yet. The desk will check again.'}};
    }
    await update({status:'review',meetingId:material.meetingId,material});
    return {...payload(),sync:{status:'review',message:'Transcript retrieved. Draft the notes, then confirm the outcome.'}};
  }
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host;
      const validHosts=[`127.0.0.1:${server.address()?.port}`,`localhost:${server.address()?.port}`];
      if(!validHosts.includes(host))return json(res,403,{error:'This workspace only accepts local requests.'});
      const url=new URL(req.url,`http://${host}`);
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      if(url.pathname.startsWith('/api/')){
        if(req.method==='GET'&&url.pathname==='/api/wispr/callback'){
          let message;let ok=false;try{await wispr.callback(url.searchParams);ok=true;message='Wispr is connected. Return to the desk and refresh the connection.';}catch{message='Wispr sign-in was not completed. Return to the desk and choose Connect Wispr again.';}
          res.writeHead(ok?200:400,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Bevamped · Wispr connection</title><body><h1>${ok?'Wispr connected':'Connection not completed'}</h1><p>${message}</p><a href="/">Return to Bevamped</a></body></html>`);
        }
        if(req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&!validHosts.some(h=>req.headers.origin===`http://${h}`)))return json(res,403,{error:'Requests must come from this local workspace.'});
        if(req.method==='GET'&&url.pathname==='/api/wispr/status')return json(res,200,{...await wispr.status(),...await analysisInfo()});
        if(req.method==='POST'&&url.pathname.startsWith('/api/wispr/')){
          if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Expected JSON.'});
          const input=await body(req);
          if(url.pathname==='/api/wispr/connect')return json(res,200,await wispr.connect(`http://127.0.0.1:${server.address().port}/api/wispr/callback`));
          if(url.pathname==='/api/wispr/disconnect')return json(res,200,await wispr.disconnect());
          if(url.pathname==='/api/wispr/preview'){
            wisprLink(input.notesUrl);if(previewBusy)return json(res,409,{error:'A preview is already loading.'});previewBusy=true;
            try{const meeting=await wispr.resolve(input.notesUrl);return json(res,200,{meeting:{...meetingMaterial({...meeting,id:meeting.id||'preview-only',share_link:meeting.share_link||input.notesUrl},now()),id:meeting.id||null,start:meeting.start,end:meeting.end}});}finally{previewBusy=false;}
          }
          if(['/api/wispr/sync','/api/wispr/analyze'].includes(url.pathname)){
            const s=openSession(input.sessionId);if(sessionJobs.has(s.id))return json(res,409,{error:'This call is already syncing or being analyzed. Wait for the current request.'});sessionJobs.add(s.id);
            try{
              if(url.pathname.endsWith('/sync'))return json(res,200,await syncCall(input));
              const generation=workspaceGeneration;
              if(!s.material?.transcript?.trim())throw new Error('Retrieve this call’s transcript before drafting notes.');
              const transcript=s.material.transcript,meetingId=s.meetingId;
              const suggestion=await analyze({transcript,summary:s.material.summary,leadName:dataset.leads.find(l=>l.id===s.leadId).name,startedAt:s.startedAt,endedAt:s.endedAt});
              const latest=openSession(s.id);if(latest.meetingId!==meetingId||latest.material?.transcript!==transcript)throw new Error('Call evidence changed during analysis. Draft again.');
              await commit({type:'update_call_session',payload:{sessionId:s.id,leadId:s.leadId,status:'review',suggestion}},generation);return json(res,200,payload());
            }finally{sessionJobs.delete(s.id);}
          }
          return json(res,404,{error:'Not found.'});
        }
        if(req.method==='GET'&&url.pathname==='/api/bootstrap')return json(res,200,payload());
        if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{ok:true,app:'bevamped-lead-desk',leads:dataset.leads.length,revision:state.revision});
        if(req.method==='GET'&&url.pathname==='/api/export'){
          const format=url.searchParams.get('format')||'backup';
          if(format==='csv'){
            const headers=['Lead_ID','Studio_Name','City','Area','Research_Status','Your_Stage','Website','Instagram','Public_Phone','Email','Principal','AI_Score','Your_Verification','Your_Notes','Next_Follow_Up','Next_Action','Call_Count','Last_Call_Outcome','Booked_Meetings','Source_Count','Conflicts','Research_Detail','Call_Transcripts_And_Reviews'];
            const rows=dataset.leads.map(l=>{const s=leadState(state,l);const calls=state.calls.filter(c=>c.leadId===l.id).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));return [l.id,l.name,l.city,l.area,l.researchStatus,s.stage,l.website,l.instagram,(l.phones||[]).map(p=>p.number).join('; '),l.email,l.principal?.name,l.score,s.review?.note,(s.notes||[]).map(n=>`${n.createdAt}: ${n.text}`).join('\n'),s.followUpDate,s.nextAction,calls.length,calls.at(-1)?.outcome,calls.filter(c=>c.outcome==='meeting_booked').map(c=>c.meetingAt).join('; '),(l.sourceIds||[]).length,(l.conflicts||[]).map(c=>`${c.field}: ${JSON.stringify(c.values)}`).join('\n'),JSON.stringify(l),JSON.stringify(calls.filter(c=>c.material).map(c=>({callId:c.id,occurredAt:c.occurredAt,material:c.material,suggestion:c.suggestion})))];});
            const csv='\uFEFF'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');
            res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="Bevamped-lead-bank-${localDate(now())}.csv"`,'Cache-Control':'no-store'});return res.end(csv);
          }
          const backup={kind:'bevamped-lead-desk-backup',schemaVersion:1,exportedAt:now(),datasetHash,dataset,state};
          res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="Bevamped-workspace-${localDate(now())}.json"`,'Cache-Control':'no-store'});return res.end(JSON.stringify(backup,null,2));
        }
        if(req.method==='POST'&&['/api/command','/api/restore'].includes(url.pathname)){
          if(req.headers.origin && !validHosts.some(h=>req.headers.origin===`http://${h}`))return json(res,403,{error:'Changes must come from this local workspace.'});
          if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Expected JSON.'});
          const input=await body(req);
          if(input.command?.type==='update_call_session')return json(res,403,{error:'Recording evidence can only be updated through Wispr sync.'});
          const operation=chain.then(async()=>{
            if(input.revision!==state.revision){json(res,409,{error:'Another tab saved a change. Refresh the workspace before saving again; your text is still on screen.',revision:state.revision});return;}
            let next;
            if(url.pathname==='/api/restore'){
              if(input.backup?.kind!=='bevamped-lead-desk-backup'||input.backup.datasetHash!==datasetHash)throw new Error('Choose a backup exported from this same lead bank.');
              validateState(input.backup.state,dataset);next=structuredClone(input.backup.state);next.revision=state.revision+1;next.updatedAt=now();
              next.events.push({id:randomBytes(12).toString('hex'),type:'backup_restored',leadId:'',detail:{previousRevision:state.revision,restoredRevision:input.backup.state.revision},createdAt:now(),date:localDate(now())});
            }else next=applyCommand(state,dataset,input.command,now());
            await persist(next);if(url.pathname==='/api/restore')workspaceGeneration++;json(res,200,payload());
          });
          chain=operation.catch(()=>{});await operation;return;
        }
        return json(res,404,{error:'Not found.'});
      }
      if(req.method!=='GET')return json(res,405,{error:'Method not allowed.'});
      const publicPath=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).replace(/^\//,'');
      const file=path.resolve(ROOT,'public',publicPath);
      if(!file.startsWith(path.join(ROOT,'public')+path.sep))return json(res,404,{error:'Not found.'});
      if(!MIME[path.extname(file)])return json(res,404,{error:'Not found.'});
      let bytes;try{bytes=await readFile(file);}catch(e){if(e.code==='ENOENT')return json(res,404,{error:'Not found.'});throw e;}
      res.writeHead(200,{'Content-Type':MIME[path.extname(file)],'Cache-Control':'no-cache'});res.end(bytes);
    }catch(e){if(!res.headersSent)json(res,e.code==='EACCES'||e.code==='ENOSPC'?503:400,{error:e.code==='EACCES'||e.code==='ENOSPC'?'Could not save to disk. Your change was not committed. Check disk space and folder access.':e.message});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,port:server.address().port,stateFile,backupsDir,close:()=>new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  createDesk().then(({port})=>process.stdout.write(`Bevamped lead desk ready at http://127.0.0.1:${port}\n`)).catch(e=>{process.stderr.write(`${e.message}\n`);process.exitCode=1;});
}
