import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {openSync,mkdirSync,closeSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url));
const address='http://127.0.0.1:4318';
function health(){return new Promise(resolve=>{
  const req=request(address+'/api/health',{timeout:1000},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{try{const data=JSON.parse(body);resolve(data.app==='bevamped-lead-desk'&&data.ok);}catch{resolve(false);}});});
  req.on('timeout',()=>req.destroy());req.on('error',()=>resolve(false));req.end();
});}
try{
  if(!await health()){
    mkdirSync(path.join(root,'saved'),{recursive:true});
    const log=openSync(path.join(root,'saved','server.log'),'a');
    let launchError;
    const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,PORT:'4318',BEVAMPED_STATE_DIR:path.join(root,'saved')}});
    child.on('error',err=>launchError=err);child.unref();closeSync(log);
    let ready=false;
    for(let attempt=0;attempt<24;attempt++){if(launchError)throw launchError;await new Promise(resolve=>setTimeout(resolve,250));if(await health()){ready=true;break;}}
    if(!ready)throw new Error('The desk could not start. See saved/server.log. Another app may already be using port 4318.');
  }
  if(!process.argv.includes('--no-open')){
    const browser=spawn('cmd.exe',['/c','start','',address],{detached:true,windowsHide:true,stdio:'ignore'});
    browser.on('error',err=>process.stderr.write(`Open ${address} in your browser. ${err.message}\n`));browser.unref();
  }
  process.stdout.write(`Bevamped is ready: ${address}\n`);
}catch(err){process.stderr.write(`${err.message}\n`);process.exitCode=1;}
