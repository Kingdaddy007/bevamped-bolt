import { randomUUID } from 'node:crypto';
import {applyWorkflow,validateWorkflow} from './workflow.mjs';

export const STAGES = ['review', 'approved', 'followup', 'booked', 'deferred', 'disqualified', 'closed', 'excluded'];
export const OUTCOMES = ['no_answer', 'connected', 'follow_up', 'meeting_booked', 'not_interested', 'wrong_number'];
export const localDate = (value = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function initialState(now = new Date().toISOString()) {
  return { schemaVersion: 1, revision: 0, updatedAt: now, settings: { reviewTarget: 10, callLimit: 20, bookingTarget: 3, zeroBookingAtLimit: 'decide' }, leadStates: {}, days: {}, calls: [], callSessions: [], events: [] };
}
export function leadState(state, lead) {
  return state.leadStates[lead.id] || { stage: lead.researchStatus === 'excluded' ? 'excluded' : 'review', review: { portfolio: false, presence: false, contact: false, note: '', approvedAt: null }, notes: [], followUpDate: '', nextAction: '', reason: '' };
}
function storedLead(state, lead) {
  if (!state.leadStates[lead.id]) state.leadStates[lead.id] = structuredClone(leadState(state, lead));
  return state.leadStates[lead.id];
}
const text = (x, limit = 12000) => typeof x === 'string' ? x.trim().slice(0, limit) : '';
function materialText(value,limit,label){if(value==null)return '';if(typeof value!=='string')throw new Error(`${label} must be text.`);if(value.length>limit)throw new Error(`${label} is too long (maximum ${limit.toLocaleString()} characters). Nothing was saved.`);return value;}
function materialLink(value){const raw=materialText(value,3000,'Notes link').trim();if(!raw)return '';try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)throw new Error();return u.href;}catch{throw new Error('Use a complete HTTPS notes link, without a password.');}}
function callMaterial(p,now,previous={}) {
  if(!p||typeof p!=='object'||Array.isArray(p)||!['wispr_flow','other','manual'].includes(p.provider))throw new Error('Choose the transcript source.');
  const result={provider:p.provider,notesUrl:materialLink(p.notesUrl),transcript:materialText(p.transcript,200000,'Transcript'),summary:materialText(p.summary,20000,'Summary'),coaching:materialText(p.coaching,20000,'Coaching notes'),updatedAt:now};
  for(const key of ['meetingId','title']){const value=p[key]??previous[key];if(value!=null)result[key]=materialText(value,key==='title'?3000:300,key);}
  for(const key of ['startedAt','endedAt','importedAt']){const value=p[key]??previous[key];if(value)result[key]=instant(value,'');}
  return result;
}
function recordingAvailable(state,meetingId,sessionId='',callId='') {
  if(!meetingId)return;
  const other=(state.callSessions||[]).some(s=>s.id!==sessionId&&s.status!=='cancelled'&&s.meetingId===meetingId);
  if(other||state.calls.some(c=>c.id!==callId&&c.material?.meetingId===meetingId))throw new Error('This recording is already attached to another call.');
}
function sessionSuggestion(value){
  if(value==null)return undefined;
  if(typeof value!=='object'||Array.isArray(value))throw new Error('Invalid call suggestion.');
  const raw=JSON.stringify(value);if(raw.length>60000)throw new Error('Call suggestion is too long.');
  if(value.outcome!==undefined&&value.outcome!==''&&!OUTCOMES.includes(value.outcome))throw new Error('Invalid suggested call outcome.');
  for(const key of ['summary','notes','coaching'])if(value[key]!==undefined)materialText(value[key],20000,key);
  if(value.nextAction!==undefined)materialText(value.nextAction,3000,'Next action');
  if(value.followUpDate)dateOnly(value.followUpDate);
  if(value.meetingAt)instant(value.meetingAt,'');
  if(value.generatedAt)instant(value.generatedAt,'');
  if(value.method!==undefined&&!['ai','manual_required'].includes(value.method))throw new Error('Invalid suggestion method.');
  for(const key of ['evidence','uncertainties'])if(value[key]!==undefined&&(!Array.isArray(value[key])||value[key].some(x=>typeof x!=='string'||x.length>12000)))throw new Error('Invalid call suggestion evidence.');
  return structuredClone(value);
}
function dateOnly(x, required = false) {
  if (!x && !required) return '';
  if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x) || Number.isNaN(Date.parse(x)) || new Date(x).toISOString().slice(0, 10) !== x) throw new Error('Choose a valid date.');
  return x;
}
function instant(x, fallback) {
  const t = x || fallback;
  if (typeof t !== 'string' || Number.isNaN(Date.parse(t))) throw new Error('Choose a valid date and time.');
  return new Date(t).toISOString();
}
function boundedInteger(n, min, max, label) {
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}.`);
  return n;
}
function event(state, type, leadId, detail, now) {
  const entry={ id: randomUUID(), type, leadId: leadId || '', detail, createdAt: now, date: localDate(now) };
  state.events.push(entry);return entry;
}
const manualWorkflowEvents=new Set(['approved','deferred','disqualified','closed','returned_to_review','followup_set']);
const changesWorkflow=e=>manualWorkflowEvents.has(e.type)||(['call_logged','call_corrected'].includes(e.type)&&e.detail?.workflowApplied!==false);
const priority = lead => lead.researchStatus === 'excluded' ? -1000 : (lead.researchStatus === 'qualified' ? 1000 : 0) + (Number.isFinite(lead.score) ? lead.score : 0);
const latestCallFor=(calls,id)=>calls.filter(c=>c.leadId===id).reduce((latest,c)=>!latest||c.occurredAt>=latest.occurredAt?c:latest,null);
export function rankedLeads(dataset) {
  return [...dataset.leads].sort((a, b) => priority(b) - priority(a) || a.name.localeCompare(b.name));
}
function fillDay(state, dataset, date) {
  if (!state.days[date]) state.days[date] = { reviewQueue: [], callQueue: [], createdAt: new Date().toISOString() };
  const day = state.days[date];
  const sorted = rankedLeads(dataset);
  for (const lead of sorted) {
    if (day.reviewQueue.length >= state.settings.reviewTarget) break;
    const s=leadState(state,lead);
    if ((s.stage === 'review' || (s.stage==='deferred' && s.followUpDate && s.followUpDate<=date)) && !day.reviewQueue.includes(lead.id)) day.reviewQueue.push(lead.id);
  }
  // Never silently rotate the day's selected leads or add unapproved research to calls.
  const due = sorted.filter(l => {
    const s = leadState(state, l);
    return (s.stage === 'approved' || s.stage === 'followup') && (!s.followUpDate || s.followUpDate <= date);
  }).sort((a,b) => (leadState(state,a).followUpDate || '9999').localeCompare(leadState(state,b).followUpDate || '9999') || priority(b)-priority(a));
  for (const lead of due) {
    if (day.callQueue.length >= state.settings.callLimit) break;
    if (!day.callQueue.includes(lead.id)) day.callQueue.push(lead.id);
  }
  return day;
}
export function dayMetrics(state, date = localDate()) {
  const calls = state.calls.filter(c => c.date === date);
  const bookings = new Set(calls.filter(c => c.outcome === 'meeting_booked' && c.meetingAt).map(c => `${c.leadId}|${c.meetingAt}`)).size;
  const reviewed = new Set(state.events.filter(e => e.date === date && ['approved','disqualified','deferred'].includes(e.type)).map(e => e.leadId)).size;
  return { calls: calls.length, bookings, reviewed, bookingGoalMet: bookings >= state.settings.bookingTarget, callLimitReached: calls.length >= state.settings.callLimit, status: bookings >= state.settings.bookingTarget ? 'goal_met' : calls.length >= state.settings.callLimit ? 'limit_reached' : 'in_progress' };
}
export function applyCommand(current, dataset, command, now = new Date().toISOString()) {
  if (!command || typeof command.type !== 'string') throw new Error('Missing action.');
  const state = structuredClone(current);
  state.callSessions ||= [];
  const p = command.payload || {};
  const date = localDate(now);
  const lead = p.leadId ? dataset.leads.find(l => l.id === p.leadId) : null;
  if (p.leadId && !lead) throw new Error('This lead is no longer in the bank.');
  const requireLead = () => { if (!lead) throw new Error('Choose a lead.'); return storedLead(state, lead); };
  const requireSession = () => {requireLead();const session=state.callSessions.find(s=>s.id===p.sessionId&&s.leadId===lead.id);if(!session)throw new Error('Call session not found for this lead.');return session;};
  if(applyWorkflow(state,dataset,command,now,date)){state.revision=current.revision+1;state.updatedAt=now;validateWorkflow(state,dataset);return state;}
  switch (command.type) {
    case 'start_call': {
      const s=requireLead();if(!['approved','followup','booked'].includes(s.stage))throw new Error('Approve this lead for calls before starting a call.');
      const active=state.callSessions.find(s=>s.status==='active');
      if(active){if(active.leadId===lead.id)break;throw new Error('Finish or cancel the active call first.');}
      const session={id:randomUUID(),leadId:lead.id,startedAt:now,status:'active'};state.callSessions.push(session);
      event(state,'call_started',lead.id,{sessionId:session.id},now);break;
    }
    case 'finish_call_session': {
      const session=requireSession();if(['waiting','review','completed'].includes(session.status))break;
      if(session.status!=='active')throw new Error('This call session was cancelled.');
      session.endedAt=instant(now,'');session.status='waiting';event(state,'call_finished',lead.id,{sessionId:session.id},now);break;
    }
    case 'cancel_call': {
      const session=requireSession();if(session.status==='cancelled')break;if(session.status==='completed')throw new Error('A completed call cannot be cancelled. Correct its call record instead.');
      session.endedAt ||= instant(now,'');session.status='cancelled';event(state,'call_cancelled',lead.id,{sessionId:session.id},now);break;
    }
    // This command is for the server integration only; public command routes must reject it.
    case 'update_call_session': {
      const session=requireSession();if(!['waiting','review'].includes(session.status))throw new Error('Finish the call before retrieving its recording.');
      if(!['waiting','review'].includes(p.status))throw new Error('Choose a valid session update.');
      const meetingId=p.meetingId??p.material?.meetingId??session.meetingId;
      if(meetingId!=null&&(typeof meetingId!=='string'||!meetingId.trim()||meetingId.length>300))throw new Error('Invalid recording identifier.');
      if(session.meetingId&&meetingId!==session.meetingId)throw new Error('This session already has a different recording.');
      recordingAvailable(state,meetingId,session.id);
      if(p.material?.meetingId&&p.material.meetingId!==meetingId)throw new Error('Recording identifiers do not match.');
      if(meetingId)session.meetingId=meetingId;
      if(p.material){const material=callMaterial({...p.material,...(meetingId?{meetingId}:{})},now,session.material);if(session.material?.transcript!==material.transcript||session.material?.summary!==material.summary)delete session.suggestion;session.material=material;}
      if(p.suggestion!==undefined)session.suggestion=sessionSuggestion(p.suggestion);
      session.status=p.status;event(state,'call_session_updated',lead.id,{sessionId:session.id,status:session.status,meetingId:session.meetingId||'',hasTranscript:!!session.material?.transcript},now);break;
    }
    case 'complete_call_session': {
      const session=requireSession();if(session.status==='completed')break;if(session.status==='cancelled')throw new Error('This call session was cancelled.');
      recordingAvailable(state,session.meetingId,session.id);
      session.endedAt ||= instant(now,'');
      const startIndex=state.events.findIndex(e=>e.type==='call_started'&&e.detail?.sessionId===session.id);
      const manualSinceStart=state.events.some((e,i)=>e.leadId===lead.id&&manualWorkflowEvents.has(e.type)&&(startIndex>=0?i>startIndex:Date.parse(e.createdAt)>Date.parse(session.startedAt)));
      const original=structuredClone(state.leadStates[lead.id]);
      if(!['approved','followup','booked'].includes(original.stage))state.leadStates[lead.id].stage='approved';
      const next=applyCommand(state,dataset,{type:'log_call',payload:{...p,occurredAt:session.startedAt}},now);
      const call=next.calls.at(-1),saved=next.callSessions.find(s=>s.id===session.id);
      if(session.material)call.material=structuredClone(session.material);
      else if(session.meetingId)call.material=callMaterial({provider:'wispr_flow',meetingId:session.meetingId},now);
      if(session.suggestion)call.suggestion=structuredClone(session.suggestion);
      if(manualSinceStart){next.leadStates[lead.id]=original;const logged=next.events.findLast(e=>e.type==='call_logged'&&e.detail?.callId===call.id);logged.detail.workflowApplied=false;}
      saved.status='completed';saved.callId=call.id;
      event(next,'call_session_completed',lead.id,{sessionId:session.id,callId:call.id},now);
      next.revision=current.revision+1;next.updatedAt=now;return next;
    }
    case 'start_day': fillDay(state, dataset, date); break;
    case 'settings': {
      state.settings.reviewTarget = boundedInteger(p.reviewTarget,1,50,'Review target');
      state.settings.callLimit = boundedInteger(p.callLimit,1,100,'Call limit');
      state.settings.bookingTarget = boundedInteger(p.bookingTarget,1,30,'Booking target');
      event(state,'settings','',{...state.settings},now); fillDay(state,dataset,date); break;
    }
    case 'save_review': {
      const s = requireLead();
      s.review = { ...s.review, portfolio: p.portfolio === true, presence: p.presence === true, contact: p.contact === true, note: text(p.note) };
      event(state,'review_saved',lead.id,{note:s.review.note},now); break;
    }
    case 'approve': {
      const s=requireLead(); const r=p.review || s.review;
      if (!r.portfolio || !r.presence || !r.contact) throw new Error('Confirm portfolio fit, web/social presence and the contact route before approving.');
      if (lead.conflicts?.some(c=>c.status!=='resolved') && !text(r.note)) throw new Error('Add a short note explaining your confirmation of the conflicting research.');
      if (lead.identityReview?.status==='unresolved' && !text(r.note)) throw new Error('Record how you confirmed this studio’s identity before approving.');
      if (/CALL HOLD/i.test(lead.manualVerificationNeeded || '') && !text(r.note)) throw new Error('Record how you confirmed the contact route before approving this lead.');
      s.review={portfolio:true,presence:true,contact:true,note:text(r.note),approvedAt:now};
      const previous=s.stage; s.stage='approved';s.reason='';s.followUpDate='';
      event(state,'approved',lead.id,{previous,note:s.review.note},now);fillDay(state,dataset,date);break;
    }
    case 'set_stage': {
      const s=requireLead();
      if (!['review','deferred','disqualified','closed'].includes(p.stage)) throw new Error('Choose a valid review action.');
      const reason=text(p.reason,3000);
      if (p.stage!=='review' && !reason) throw new Error('Add a reason so you can understand this decision later.');
      const followUpDate=dateOnly(p.followUpDate);
      if (p.stage==='deferred' && !followUpDate) throw new Error('Choose when to review this lead again.');
      const previous=s.stage;s.stage=p.stage;s.reason=reason;s.followUpDate=p.stage==='deferred'?followUpDate:'';
      if (p.stage==='review') s.review.approvedAt=null;
      event(state,p.stage==='review'?'returned_to_review':p.stage,lead.id,{previous,reason,followUpDate:s.followUpDate},now);fillDay(state,dataset,date);break;
    }
    case 'note': {
      const s=requireLead();const note=text(p.text);if(!note) throw new Error('Write a note first.');
      s.notes.push({id:randomUUID(),text:note,createdAt:now});event(state,'note',lead.id,{text:note},now);break;
    }
    case 'followup': {
      const s=requireLead();s.followUpDate=dateOnly(p.followUpDate,true);s.nextAction=text(p.nextAction,3000);
      event(state,'followup_set',lead.id,{followUpDate:s.followUpDate,nextAction:s.nextAction},now);break;
    }
    case 'log_call':
    case 'edit_call': {
      const s=requireLead();
      const existing=command.type==='edit_call'?state.calls.find(c=>c.id===p.callId && c.leadId===lead.id):null;
      const previousLatestId=latestCallFor(state.calls,lead.id)?.id;
      const previousWorkflowEvent=state.events.findLast(e=>e.leadId===lead.id&&changesWorkflow(e));
      if(command.type==='edit_call'&&!existing)throw new Error('Call record not found.');
      if(command.type==='log_call'&&!['approved','followup','booked'].includes(s.stage))throw new Error('Approve this lead for calls before logging a call.');
      if(!OUTCOMES.includes(p.outcome))throw new Error('Choose a call outcome.');
      const occurredAt=instant(p.occurredAt,now);
      if(Date.parse(occurredAt)>Date.parse(now)+60000)throw new Error('A completed call cannot be in the future.');
      const meetingAt=p.outcome==='meeting_booked'?instant(p.meetingAt,''):'';
      if(p.outcome==='meeting_booked'&&!p.meetingAt)throw new Error('Enter the booked meeting date and time.');
      if(meetingAt&&Date.parse(meetingAt)<Date.parse(occurredAt))throw new Error('The meeting must be after the call.');
      const followUpDate=dateOnly(p.followUpDate);
      if(p.outcome==='follow_up'&&!followUpDate)throw new Error('Choose a follow-up date.');
      const notes=text(p.notes);
      if(['not_interested','wrong_number'].includes(p.outcome)&&!notes)throw new Error('Add a short note about this outcome.');
      const call={...existing,id:existing?.id||randomUUID(),leadId:lead.id,occurredAt,date:localDate(occurredAt),outcome:p.outcome,notes,followUpDate,meetingAt,nextAction:text(p.nextAction,3000),loggedAt:existing?.loggedAt||now,updatedAt:now};
      let callEvent;
      if(existing){const before=structuredClone(existing);Object.assign(existing,call);callEvent=event(state,'call_corrected',lead.id,{callId:call.id,before,after:call},now);}
      else {state.calls.push(call);callEvent=event(state,'call_logged',lead.id,{callId:call.id,outcome:call.outcome},now);}
      const latest=latestCallFor(state.calls,lead.id);
      // Backdated calls and corrections to older history must not replace a later next step.
      const newerManualDecision=existing&&previousWorkflowEvent&&manualWorkflowEvents.has(previousWorkflowEvent.type);
      if(newerManualDecision || (latest.id!==call.id && (!existing || previousLatestId!==call.id))){callEvent.detail.workflowApplied=false;break;}
      callEvent.detail.workflowApplied=true;
      if(latest.outcome==='meeting_booked'){s.stage='booked';s.followUpDate=localDate(latest.meetingAt);s.nextAction='Booked meeting';}
      else if(latest.outcome==='not_interested'){s.stage='closed';s.reason=latest.notes;s.followUpDate='';s.nextAction='';}
      else if(latest.outcome==='wrong_number'){s.stage='review';s.review.contact=false;s.review.approvedAt=null;s.reason=latest.notes;s.followUpDate='';s.nextAction='';}
      else {s.stage=s.review.approvedAt?(latest.followUpDate?'followup':'approved'):'review';s.followUpDate=latest.followUpDate;s.nextAction=latest.nextAction||'';}
      fillDay(state,dataset,date);break;
    }
    case 'save_call_material': {
      requireLead();const call=state.calls.find(c=>c.id===p.callId&&c.leadId===lead.id);
      if(!call)throw new Error('Choose an existing call before attaching its transcript.');
      if(call.material?.meetingId&&p.meetingId!==undefined&&p.meetingId!==call.material.meetingId)throw new Error('The recording provenance cannot be replaced.');
      const material=callMaterial(p,now,call.material);recordingAvailable(state,material.meetingId,state.callSessions.find(s=>s.callId===call.id)?.id,call.id);
      const previousUpdatedAt=call.material?.updatedAt||null;if(call.material?.transcript!==material.transcript||call.material?.summary!==material.summary)delete call.suggestion;call.material=material;
      event(state,'call_material_saved',lead.id,{callId:call.id,provider:material.provider,hasTranscript:!!material.transcript,hasReview:!!material.coaching,previousUpdatedAt},now);break;
    }
    case 'add_to_day': {
      const s=requireLead();const day=fillDay(state,dataset,date);const kind=p.kind==='call'?'callQueue':'reviewQueue';
      if(kind==='callQueue'&&!['approved','followup'].includes(s.stage))throw new Error('Only personally approved leads can enter the calling queue.');
      if(kind==='reviewQueue'&&!['review','deferred'].includes(s.stage))throw new Error('Return this lead to review first.');
      if(!day[kind].includes(lead.id))day[kind].push(lead.id);
      event(state,'added_to_day',lead.id,{kind},now);break;
    }
    default: throw new Error('This action is not supported.');
  }
  state.revision=current.revision+1;state.updatedAt=now;
  return state;
}

export function validateState(state,dataset) {
  if(!state||state.schemaVersion!==1||!Number.isInteger(state.revision)||!state.settings||!state.leadStates||!state.days||!Array.isArray(state.calls)||!Array.isArray(state.events))throw new Error('This is not a compatible lead desk backup.');
  boundedInteger(state.settings.reviewTarget,1,50,'Review target');boundedInteger(state.settings.callLimit,1,100,'Call limit');boundedInteger(state.settings.bookingTarget,1,30,'Booking target');
  const ids=new Set(dataset.leads.map(l=>l.id));
  for(const [id,s] of Object.entries(state.leadStates)) {
    if(!ids.has(id))throw new Error(`Backup refers to an unknown lead: ${id}`);
    if(!STAGES.includes(s.stage)||!s.review||!Array.isArray(s.notes))throw new Error('Backup contains an invalid lead state.');
  }
  const callIds=new Set(),recordingCalls=new Map();
  for(const c of state.calls){if(!c||typeof c.id!=='string'||!c.id||!ids.has(c.leadId)||!OUTCOMES.includes(c.outcome)||callIds.has(c.id))throw new Error('Backup contains an invalid or duplicate call.');callIds.add(c.id);instant(c.occurredAt,'');dateOnly(c.date,true);if(c.outcome==='meeting_booked')instant(c.meetingAt,'');if(c.material){callMaterial(c.material,c.material.updatedAt);if(c.material.meetingId){if(recordingCalls.has(c.material.meetingId))throw new Error('Backup uses a recording for multiple calls.');recordingCalls.set(c.material.meetingId,c.id);}}if(c.suggestion)sessionSuggestion(c.suggestion);}
  if(state.callSessions!==undefined&&!Array.isArray(state.callSessions))throw new Error('Backup contains invalid call sessions.');
  const sessionIds=new Set(),recordingSessions=new Set(),completedCalls=new Set();let active=0;
  for(const s of state.callSessions||[]){
    if(!s||typeof s.id!=='string'||!s.id||sessionIds.has(s.id)||!ids.has(s.leadId)||!['active','waiting','review','completed','cancelled'].includes(s.status))throw new Error('Backup contains an invalid or duplicate call session.');
    sessionIds.add(s.id);instant(s.startedAt,'');
    if(s.status==='active'){active++;if(s.endedAt||s.callId||s.material||s.suggestion||s.meetingId)throw new Error('An active call session cannot contain a completed recording.');}
    else {instant(s.endedAt,'');if(Date.parse(s.endedAt)<Date.parse(s.startedAt))throw new Error('Call session ends before it starts.');}
    if(s.material){callMaterial(s.material,s.material.updatedAt);if(s.material.meetingId!==s.meetingId)throw new Error('Call session recording identifiers do not match.');}
    if(s.suggestion)sessionSuggestion(s.suggestion);
    if(s.meetingId!==undefined&&(typeof s.meetingId!=='string'||!s.meetingId.trim()||s.meetingId.length>300))throw new Error('Invalid call session recording identifier.');
    if(s.status==='completed'){
      const call=state.calls.find(c=>c.id===s.callId&&c.leadId===s.leadId);
      if(!call||completedCalls.has(s.callId)||(s.meetingId&&call.material?.meetingId!==s.meetingId))throw new Error('Completed call session does not match its call record.');
      completedCalls.add(s.callId);
    } else if(s.callId)throw new Error('Uncompleted call session refers to a call record.');
    if(s.status!=='cancelled'&&s.meetingId){
      if(recordingSessions.has(s.meetingId)||(recordingCalls.has(s.meetingId)&&recordingCalls.get(s.meetingId)!==s.callId))throw new Error('Backup uses a recording for multiple call sessions.');
      recordingSessions.add(s.meetingId);
    }
  }
  if(active>1)throw new Error('Backup contains multiple active calls.');
  for(const day of Object.values(state.days)){if(!Array.isArray(day.reviewQueue)||!Array.isArray(day.callQueue)||[...day.reviewQueue,...day.callQueue].some(id=>!ids.has(id)))throw new Error('Backup contains an invalid day queue.');}
  validateWorkflow(state,dataset);return true;
}
