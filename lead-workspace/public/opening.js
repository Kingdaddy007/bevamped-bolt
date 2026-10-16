import {meetingMark} from './bolt-brand.js';

export const defaultPrayer=[
  {title:'Recall',text:'Father, You are faithful, wise and good. You know me fully. Before I begin, I humble myself before You and place the work of my hands in Your care.'},
  {title:'Recount',text:'I remember Your guidance, Your provision and the doors You have opened. You knew Jeremiah before he was born. I remember that my own life and work are known to You.'},
  {title:'Request',text:'Father, take control of my thoughts and conversations today. Give me Your wisdom, favour and the right words. Guide me to call at the right time and connect me with people whose needs I can truly serve. Help me listen, understand their challenges and explain clearly how I can help. Open the way to honest conversations, good clients and clear next steps. Bless the work of my hands, and help me act with courage, humility and trust in You.'},
  {title:'Thanksgiving',text:'Thank You for life, ability and the opportunity to serve through my work. I begin today with faith, gratitude and a willing heart. In Jesus’ name, amen.'}
];
const key='bolt-opening-prayer-v1';
const escape=text=>String(text).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const oldRequest='Guide my thoughts and conversations today. Help me prepare diligently, listen carefully and speak truthfully. Give me wisdom to recognise the right opportunities, courage to act, and humility to trust You with the results.';
function savedPrayer(){try{const value=JSON.parse(localStorage.getItem(key));if(Array.isArray(value)&&value.length===4&&value.every((item,index)=>item.title===defaultPrayer[index].title&&typeof item.text==='string'&&item.text.trim()&&item.text.length<=1800))return value.map(part=>part.title==='Request'&&part.text===oldRequest?{...part,text:defaultPrayer[2].text}:part);}catch{}return defaultPrayer;}
let activeOpening=null;
export function showOpening(){
  if(activeOpening)return activeOpening;
  let resolveEntry;
  const promise=new Promise(resolve=>resolveEntry=resolve);activeOpening=promise;
  const prayer=savedPrayer();
  const gate=document.createElement('dialog');gate.id='opening-gate';gate.className='opening-gate';gate.dataset.stage='brand';gate.setAttribute('aria-label','BOLT opening');gate.tabIndex=-1;
  const lettering=`<svg class="intro-lettering" viewBox="150 30 224 84" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="9" stroke-linejoin="round"><path d="M164 103V41h21c24 0 24 30 0 30h-21m0 0h23c25 0 25 32 0 32h-23M243 41c-15 0-21 11-21 31s6 31 21 31 21-11 21-31-6-31-21-31ZM282 41v62h29M317 41h48m-24 0v62"/></g></svg>`;
  gate.innerHTML=`<div class="brand-intro" aria-hidden="true">${meetingMark('intro-symbol')}${lettering}</div><button class="intro-skip" type="button" data-skip-intro>Continue to the prayer ↵</button><div class="opening-shell" hidden><header class="opening-header"><span>BEVAMPED / RRRT</span><button class="opening-theme" data-opening-theme data-theme-toggle type="button">Dark mode</button></header><main class="opening-main"><div class="opening-title-row"><div><p>RECALL · RECOUNT · REQUEST · THANKSGIVING</p><h1 id="opening-title" tabindex="-1">Heavenly Father,</h1></div><span class="opening-date">${escape(new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',weekday:'long',day:'numeric',month:'long'}).format(new Date()))}</span></div><div class="prayer-text" data-prayer></div><div class="prayer-entry" hidden><button type="button" class="enter-bolt" data-enter-bolt>Enter BOLT <span>↵</span></button><p>Press Enter when you’re ready.</p></div><div class="prayer-reading-controls"><button type="button" data-replay-prayer>Read it again ↻</button><button type="button" data-show-prayer>Show all words</button></div><details class="prayer-editor"><summary>Make this prayer your own</summary><p>Your words are saved in this browser. Edit each part, then save to replay it.</p><form id="prayer-editor-form">${prayer.map((part,index)=>`<label>${part.title}<textarea name="part-${index}" rows="3" maxlength="1800" required>${escape(part.text)}</textarea></label>`).join('')}<div class="prayer-editor-actions"><button type="submit">Save my wording</button><span data-prayer-status role="status"></span></div></form></details></main></div>`;
  let brandTimer,entryTimer;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function renderWords(parts,{immediate=false}={}){
    gate.querySelector('[data-prayer]').innerHTML=parts.map((part,index)=>`<section class="prayer-part"><div class="prayer-section-label"><span>0${index+1}</span><h2>${part.title}</h2></div><p aria-label="${escape(part.text)}"><span aria-hidden="true">${part.text.trim().split(/\s+/).map(word=>`<span class="prayer-word">${escape(word)}</span>`).join(' ')}</span></p></section>`).join('');
    gate.classList.toggle('words-visible',immediate);
  }
  // Set the bounded delay through
  // element.style, the same supported mechanism used by app progress bars.
  function applyWordDelays(){
    clearTimeout(entryTimer);let index=0;const entry=gate.querySelector('.prayer-entry');entry.hidden=!reduced;
    gate.querySelectorAll('.prayer-word').forEach(word=>word.style.setProperty('--word-delay',`${350+index++*150}ms`));
    if(!reduced)entryTimer=setTimeout(()=>{entry.hidden=false;},350+Math.max(0,index-1)*150+650);
  }
  function revealPrayer(){
    if(gate.dataset.stage!=='brand')return;clearTimeout(brandTimer);gate.dataset.stage='prayer';
    gate.querySelector('.brand-intro').hidden=true;gate.querySelector('[data-skip-intro]').hidden=true;gate.querySelector('.opening-shell').hidden=false;
    gate.removeAttribute('aria-label');gate.setAttribute('aria-labelledby','opening-title');renderWords(savedPrayer());applyWordDelays();gate.scrollTop=0;gate.querySelector('#opening-title').focus({preventScroll:true});
  }
  document.body.append(gate);gate.showModal();window.BoltAppearance.sync();gate.focus({preventScroll:true});
  if(reduced)revealPrayer();else brandTimer=setTimeout(revealPrayer,7800);
  gate.querySelector('[data-skip-intro]').addEventListener('click',revealPrayer);
  gate.querySelector('[data-opening-theme]').addEventListener('click',()=>window.BoltAppearance.toggle());
  gate.querySelector('[data-show-prayer]').addEventListener('click',()=>{clearTimeout(entryTimer);gate.classList.add('words-visible');gate.querySelector('.prayer-entry').hidden=false;});
  gate.querySelector('[data-replay-prayer]').addEventListener('click',()=>{renderWords(savedPrayer());applyWordDelays();gate.querySelector('#opening-title').focus({preventScroll:true});});
  gate.querySelector('#prayer-editor-form').addEventListener('submit',event=>{
    event.preventDefault();const form=new FormData(event.target);
    const next=defaultPrayer.map((part,index)=>({title:part.title,text:String(form.get(`part-${index}`)||'').trim()}));
    if(next.some(part=>!part.text)){gate.querySelector('[data-prayer-status]').textContent='Write something in each part before saving.';return;}
    try{localStorage.setItem(key,JSON.stringify(next));renderWords(next);applyWordDelays();gate.querySelector('[data-prayer-status]').textContent='Your wording is saved in this browser.';}catch{gate.querySelector('[data-prayer-status]').textContent='Browser storage is unavailable. Your typed words are still here; keep a copy before closing.';}
  });
  gate.querySelector('[data-enter-bolt]').addEventListener('click',()=>gate.close());
  gate.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.repeat&&!event.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.shiftKey&&!['INPUT','TEXTAREA','SELECT','BUTTON','A','SUMMARY'].includes(event.target.tagName)){event.preventDefault();if(gate.dataset.stage==='brand')revealPrayer();else gate.close();}
    event.stopPropagation();
  });
  gate.addEventListener('cancel',event=>event.preventDefault());
  gate.addEventListener('close',()=>{clearTimeout(brandTimer);clearTimeout(entryTimer);gate.remove();activeOpening=null;resolveEntry();},{once:true});
  return promise;
}
