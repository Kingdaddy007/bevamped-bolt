// BOLT's identity and presentation helpers; operational data stays in app.js.
export function meetingMark(className=''){
  return `<svg class="meeting-mark ${className}" viewBox="0 0 144 144" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"><path class="piece p1" d="M59 25H47c-14 0-23 10-23 24v17"/><path class="piece p2" d="M85 119h12c14 0 23-10 23-24V78"/><path class="piece p3" d="M85 25h12c14 0 23 10 23 24v5"/><path class="piece p4" d="M59 119H47c-14 0-23-10-23-24v-5"/><path d="M52 72h40"/></g><circle class="meeting-centre" cx="72" cy="72" r="10" fill="currentColor" stroke="none"/></svg>`;
}

export function playWelcome(root=document){
  const mark=root.querySelector('[data-welcome-mark]');
  if(!mark)return;
  mark.classList.remove('gathering');
  void mark.getBoundingClientRect();
  mark.classList.add('gathering');
  // One handler even when replay is interrupted or reduced motion is enabled.
  mark.onanimationend=event=>{if(event.animationName==='bolt-centre'){mark.classList.remove('gathering');mark.onanimationend=null;}};
}

export function composeCallReview(modal){
  const form=modal.querySelector('#modal-form');
  const evidence=form?.querySelector('.synced-material');
  if(!evidence)return;
  modal.classList.add('session-review');
  const heading=evidence.querySelector('h3');
  if(heading)heading.textContent='The conversation';
  const transcript=evidence.querySelector('details');
  if(transcript){transcript.open=true;transcript.querySelector('summary').textContent='Full transcript';}
  const summary=evidence.querySelector('.sync-summary');
  if(summary){
    const details=document.createElement('details');
    const label=document.createElement('summary');label.className='details-toggle';label.textContent='Wispr summary';
    details.append(label,summary);evidence.append(details);
  }
  const layout=document.createElement('div');layout.className='call-review-layout';
  const record=document.createElement('section');record.className='call-review-record';record.setAttribute('aria-label','Review and confirm this call');
  // Move existing nodes, preserving fields, validation, FormData and handlers.
  const siblings=[];for(let node=evidence.nextSibling;node;node=node.nextSibling)siblings.push(node);
  evidence.before(layout);layout.append(evidence,record);record.append(...siblings);
}
