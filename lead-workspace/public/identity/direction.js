// Isolated design specimen: no network, storage or operational app commands.
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const sampleLeads=[
  {name:'Atelier Noma',initials:'AN',city:'Lagos',type:'Interior design',status:'Review needed',observation:'A portfolio-led studio. Check how clearly its projects explain the brief, process and finished space.'},
  {name:'Form & Field',initials:'FF',city:'Abuja',type:'Interior architecture',status:'Review needed',observation:'Review its project presentation and enquiry route. Write down a specific observation before suggesting a change.'},
  {name:'The Haven Studio',initials:'HS',city:'Lagos',type:'Residential interiors',status:'Check contact',observation:'Confirm which public contact reaches the studio, then review the work and decide whether a conversation would be useful.'},
  {name:'Oru Living',initials:'OL',city:'Ibadan',type:'Furniture & spaces',status:'Review needed',observation:'Check how a visitor moves from a finished space to its furniture details and next step.'},
  {name:'Studio Sand',initials:'SS',city:'Abuja',type:'Interior design',status:'Review needed',observation:'Review the project evidence and note what a potential client can understand about the studio’s process.'},
  {name:'Casa Forma',initials:'CF',city:'Lagos',type:'Interior design',status:'Check contact',observation:'Verify the studio’s identity and contact route before making an outreach decision.'},
  {name:'Mora Spaces',initials:'MS',city:'Port Harcourt',type:'Spatial design',status:'Review needed',observation:'Explore the studio’s work and enquiry journey. Keep observations separate from assumptions.'},
  {name:'Nook Practice',initials:'NP',city:'Lagos',type:'Residential interiors',status:'Review needed',observation:'Check whether a first-time visitor can follow a project from brief to finished space.'},
  {name:'Aro Objects',initials:'AO',city:'Abuja',type:'Furniture & spaces',status:'Review needed',observation:'Inspect how pieces are presented in a room and how a visitor can ask about a particular item.'},
  {name:'The Cedar Room',initials:'CR',city:'Lagos',type:'Interior design',status:'Review needed',observation:'Review the work, current activity and public contact route before deciding whether to call.'}
].map((lead,index)=>({...lead,index,stage:'review',note:''}));
let selected=0,queue='review',showAll=false,sampleCallSaved=false,dialogLead=0;
let toastTimer;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
// Expand only the two animated instances; direct paths make interruption and
// reduced-motion behaviour independent of SVG use-element shadow trees.
for(const svg of $$('#alignment svg, #motion-mark svg')){svg.replaceChildren(...[...$('#mark').childNodes].map(node=>node.cloneNode(true)));}
function join(element){element.classList.remove('joining');void element.offsetWidth;element.classList.add('joining');}
for(const element of $$('#alignment,#motion-mark'))element.addEventListener('animationend',event=>{if(event.target.classList.contains('centre'))element.classList.remove('joining');});
$('#replay').addEventListener('click',()=>join($('#alignment')));
$('#identity-replay').addEventListener('click',()=>join($('#motion-mark')));
function navigate(view,{focus=false}={}){
  if(!['today','review','identity'].includes(view))view='today';
  $$('.view').forEach(section=>section.hidden=section.id!==`view-${view}`);
  $$('[data-view]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  history.replaceState(null,'',`#${view}`);
  if(focus)$(`#${view}-title`).focus({preventScroll:true});
  window.scrollTo({top:0,behavior:'instant'});
}
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.view,{focus:true})));
$('.brand').addEventListener('click',event=>{event.preventDefault();navigate('today',{focus:true});});
function setSelected(index){
  selected=index;const lead=sampleLeads[index];
  $('#focus-name').textContent=lead.name;$('#focus-location').textContent=`${lead.city} · ${lead.type}`;
  $('#focus-observation').textContent=lead.observation;
  $('#focus-index').textContent=`${String(index+1).padStart(2,'0')} / 10`;
  $('#studio-monogram').replaceChildren(document.createTextNode(lead.initials),Object.assign(document.createElement('span'),{textContent:String(index+1).padStart(2,'0')}));
  $('.focus-label>span').textContent=queue==='ready'?'READY FOR A CONVERSATION':'NEXT TO REVIEW';
  $('#open-lead').innerHTML=queue==='ready'?'Open sample call review <svg class="icon"><use href="#arrow-icon"/></svg>':'Review this lead <svg class="icon"><use href="#arrow-icon"/></svg>';
  $$('.lead-row').forEach(row=>{const active=Number(row.dataset.index)===index;row.classList.toggle('selected',active);row.setAttribute('aria-pressed',String(active));});
}
function renderQueue(){
  const leads=sampleLeads.filter(lead=>lead.stage===queue),visible=showAll?leads:leads.slice(0,4);
  const list=$('#lead-list');list.replaceChildren();
  for(const lead of visible){
    const row=document.createElement('button');row.type='button';row.className='lead-row';row.dataset.index=lead.index;
    // All template content is fixed local sample copy, never imported lead data.
    row.innerHTML=`<span class="lead-order">${String(lead.index+1).padStart(2,'0')}</span><span><strong>${lead.name}</strong><small>${lead.city} · ${lead.type}</small></span><span class="status">${queue==='ready'?'Approved':lead.status}</span>`;
    row.addEventListener('click',()=>setSelected(lead.index));list.append(row);
  }
  $('#queue-empty').hidden=leads.length>0;$('.list-head').hidden=!leads.length;
  $('.lead-focus').hidden=!leads.length;
  $('#show-all').hidden=leads.length<=4;$('#show-all').innerHTML=showAll?'Show fewer leads <span>↑</span>':`Show all ${leads.length} leads <span>↓</span>`;
  $('#empty-copy').textContent=queue==='ready'?'Review a sample lead and approve it to see it in this queue.':'Follow-ups will have a date and a concrete next action. This sample has none due today.';
  $('#review-count').textContent=sampleLeads.filter(l=>l.stage==='review').length;$('#ready-count').textContent=sampleLeads.filter(l=>l.stage==='ready').length;
  if(leads.length)setSelected(leads.some(l=>l.index===selected)?selected:leads[0].index);
}
function switchQueue(name){queue=name;showAll=false;$$('[data-queue]').forEach(button=>{const active=button.dataset.queue===queue;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;});$('#queue-panel').setAttribute('aria-labelledby',`tab-${name}`);renderQueue();}
$$('[data-queue]').forEach(button=>{button.addEventListener('click',()=>switchQueue(button.dataset.queue));button.addEventListener('keydown',event=>{const tabs=$$('[data-queue]'),index=tabs.indexOf(button);let next;if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;event.preventDefault();switchQueue(tabs[next].dataset.queue);tabs[next].focus();});});
$('#show-all').addEventListener('click',()=>{showAll=!showAll;renderQueue();});
$('#open-lead').addEventListener('click',()=>{
  if(queue==='ready'){navigate('review',{focus:true});toast('Call review shows a separate, fixed sample conversation for Atelier Noma.');return;}
  dialogLead=selected;$('#lead-dialog-title').textContent=sampleLeads[dialogLead].name;$('#review-note').value=sampleLeads[dialogLead].note;$('#lead-dialog').showModal();
});
$('#close-lead').addEventListener('click',()=>$('#lead-dialog').close());
for(const [buttonId,stage] of [['approve','ready'],['disqualify','excluded']]){
  $(`#${buttonId}`).addEventListener('click',()=>{const lead=sampleLeads[dialogLead];lead.stage=stage;lead.note=$('#review-note').value;$('#lead-dialog').close();renderQueue();toast(`${lead.name}: ${stage==='ready'?'approved in the preview':'removed from the sample queue'}. Real records are unchanged.`);});
}
$('#lead-dialog').addEventListener('close',()=>{sampleLeads[dialogLead].note=$('#review-note').value;});
$('#targets').addEventListener('click',()=>$('#target-dialog').showModal());$('#close-targets').addEventListener('click',()=>$('#target-dialog').close());
$('#show-coaching').addEventListener('click',()=>$('#coaching-dialog').showModal());$('#close-coaching').addEventListener('click',()=>$('#coaching-dialog').close());
function meetingFields(){const booked=$('#outcome').value==='meeting_booked';$('#meeting-field').hidden=!booked;$('#meeting-help').hidden=!booked;$('#meeting-at').required=booked;}
$('#outcome').addEventListener('change',meetingFields);
$('#draft').addEventListener('click',()=>{
  const edited=[$('#call-notes'),$('#next-action'),$('#follow-date'),$('#meeting-at'),$('#outcome')].some(field=>field.value);
  if(edited){toast('Your edits are kept. Clear the fields first if you want to try the sample draft again.');return;}
  $('#outcome').value='meeting_booked';$('#call-notes').value='The owner said new clients mostly discover the studio through Instagram, and the website’s projects have not been updated recently. They agreed to a 20-minute project review on 22 October 2026 at 11:00 Lagos time. No budget or purchase commitment was discussed.';
  $('#next-action').value='Chris: prepare one project for the review. Confirm the meeting details with the studio owner.';
  $('#meeting-at').value='2026-10-22T11:00';$('#draft-label').textContent='SAMPLE DRAFT · CHECK EVERY FIELD';$('#draft-heading').textContent='A starting point. Yours to check.';
  $('#draft-copy').textContent='Based on the sample excerpt on the left. You can change the outcome, notes and meeting details.';$('#draft').textContent='Sample draft applied';$('#review-stage').textContent='REVIEW THE DRAFT';meetingFields();
  $('#call-message').textContent='Sample draft applied. No AI service was called. Check the commitment and meeting time against the excerpt.';
});
$('#call-form').addEventListener('submit',event=>{
  event.preventDefault();if(!$('#call-form').reportValidity())return;
  const booked=$('#outcome').value==='meeting_booked';
  if(!sampleCallSaved){sampleCallSaved=true;$('#calls-count').textContent='1';}
  $('#bookings-count').textContent=booked?'1':'0';$('.booking-steps').setAttribute('aria-label',`${booked?1:0} of 3 bookings`);$('.booking-steps i').classList.toggle('filled',booked);
  $('#draft-label').textContent='CONFIRMED IN PREVIEW';$('#review-stage').textContent='SAMPLE CALL CONFIRMED';
  $('#call-message').textContent='Confirmed in this preview only. No real call, booking, calendar event or transcript was saved. Reloading resets the sample.';
  $('#confirm-call').innerHTML='Update sample call <svg class="icon"><use href="#check-icon"/></svg>';
  $('#alignment').classList.remove('just-saved');void $('#alignment').offsetWidth;$('#alignment').classList.add('just-saved');
  toast('Sample call confirmed. Your working desk is unchanged.');
});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
renderQueue();navigate(location.hash.slice(1)||'today');join($('#alignment'));
