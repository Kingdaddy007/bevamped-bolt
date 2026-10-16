const providers={wispr_flow:'Wispr Flow',other:'Other recorder',manual:'Personal notes'};

export function callMaterialFields(call,e){
  const m=call.material||{};
  return `<p class="field-help">Attach the evidence from this specific call. Wispr records separately. Use Start call and Finish &amp; sync for retrieval, or attach notes here manually.</p>
    <label class="form-field">Transcript source<select name="provider">${Object.entries(providers).map(([value,label])=>`<option value="${value}" ${(m.provider||'wispr_flow')===value?'selected':''}>${label}</option>`).join('')}</select></label>
    <label class="form-field">Wispr / meeting notes link<input name="notesUrl" type="url" value="${e(m.notesUrl||'')}" placeholder="Paste the HTTPS notes link (optional)"></label>
    <label class="form-field">Full transcript<textarea name="transcript" class="tall" maxlength="200000" placeholder="Paste the conversation with speaker labels and timestamps where available…">${e(m.transcript||'')}</textarea><span class="field-help">Keep both voices. A summary alone cannot show the exact questions and responses.</span></label>
    <label class="form-field">Meeting summary · optional<textarea name="summary" maxlength="20000" placeholder="The main points, objections and agreed next step…">${e(m.summary||'')}</textarea></label>
    <label class="form-field">Coaching notes<textarea name="coaching" maxlength="20000" placeholder="What worked, what to change, evidence from the call, and one focus for the next call…">${e(m.coaching||'')}</textarea></label>
    <p class="field-help">Ask Codex in this chat to review a saved call or its Wispr note. This manual form does not generate a performance score or AI review.</p>`;
}

export function callMaterialMarkup(call,{e,link}){
  const m=call.material;if(!m)return '';const suggestion=call.suggestion;
  const status=[m.transcript?'Transcript saved':'',m.coaching?'Coaching notes saved':''].filter(Boolean).join(' · ');
  return `<details class="call-material"><summary class="details-toggle">${e(providers[m.provider]||'Call evidence')}${status?' · '+e(status):' · linked notes'}</summary>
    ${m.notesUrl?link(m.notesUrl,'Open meeting notes'):''}
    ${m.summary?`<h4>Meeting summary</h4><p>${e(m.summary)}</p>`:''}
    ${m.coaching?`<h4>Coaching notes</h4><p>${e(m.coaching)}</p>`:''}
    ${suggestion?`<section class="suggestion"><h4>AI review · retained draft</h4>${suggestion.summary?`<p>${e(suggestion.summary)}</p>`:''}${suggestion.coaching?`<h4>Coaching for your next call</h4><p>${e(suggestion.coaching)}</p>`:''}${suggestion.evidence?.length?`<h4>Transcript evidence</h4><pre class="source-raw">${e(suggestion.evidence.join('\n'))}</pre>`:''}${suggestion.uncertainties?.length?`<h4>Needs checking</h4><p>${e(suggestion.uncertainties.join('\n'))}</p>`:''}<p class="field-help">Your confirmed outcome and notes are recorded above. These are the original AI suggestions.</p></section>`:''}
    ${m.transcript?`<h4>Transcript · supplied text</h4><pre class="source-raw">${e(m.transcript)}</pre>`:''}
    ${!m.transcript&&!m.summary&&!m.coaching&&!m.notesUrl?'<p>No call materials saved yet.</p>':''}
    </details>`;
}
