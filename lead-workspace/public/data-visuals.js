export {weeklySeries} from './activity-data.js';
// Read-only views of saved activity. No forecasts, inferred outcomes or demo data.
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const point=(r,a,c=130)=>[c+r*Math.cos(a*Math.PI/180),c+r*Math.sin(a*Math.PI/180)].map(n=>+n.toFixed(3));
export function arcPath(r,start,end,c=130){const a=point(r,start,c),b=point(r,end,c);return `M${a.join(',')} A${r},${r} 0 ${end-start>180?1:0} 1 ${b.join(',')}`;}
const remaining=(value,target)=>Math.max(0,target-value);

function bookingDial(value,target){
  const gap=Math.min(8,130/target),sweep=280/target,segments=Array.from({length:target},(_,i)=>`<path class="dial-segment ${i<value?'is-filled':''}" d="${arcPath(105,130+i*sweep+gap/2,130+(i+1)*sweep-gap/2)}"/>`).join('');
  const ticks=Array.from({length:41},(_,i)=>{const a=130+i*7,p=point(120,a),q=point(i%5===0?125:122,a);return `<path d="M${p.join(',')} L${q.join(',')}"/>`;}).join('');
  return `<div class="booking-dial" data-dense="${target>12}" role="img" aria-label="${value} of ${target} bookings today${value>=target?'; goal reached':''}"><svg viewBox="0 0 260 260" aria-hidden="true"><g class="dial-calibration">${ticks}</g><path class="dial-hairline" d="${arcPath(88,130,410)}"/>${segments}<path class="dial-cross" d="M125 54h10m-5-5v10"/></svg><div class="dial-reading"><span>BOOKINGS TODAY</span><strong>${value}<small>/ ${target}</small></strong><span class="dial-reading-caption">${value>=target?'Goal reached':'Agreed meetings'}</span></div><div class="dial-endpoints" aria-hidden="true"><span>0</span><span>${target}</span></div></div>`;
}
function track(label,value,target,kind,caption){
  const slots=Array.from({length:target},(_,i)=>`<i class="${i<value?'is-filled':''}"></i>`).join('');
  return `<div class="signal-track ${kind}"><div class="signal-track-heading"><h3>${label}</h3><p><strong>${value}</strong><span>/ ${target}</span></p></div><div class="signal-slots" aria-hidden="true">${slots}</div><p class="signal-track-note">${escape(caption)}</p></div>`;
}
export function dailyVisuals(boot){
  const m=boot.metrics,s=boot.state.settings,status=m.bookingGoalMet?'Your daily goal is met.':m.callLimitReached?'Your call limit is reached.':m.calls?'Your day is taking shape.':'A clear start to the day.';
  const note=m.bookingGoalMet?'You can finish here, even if you have calls left.':m.callLimitReached?'Pause here, or choose to continue. The decision is yours.':`${remaining(m.bookings,s.bookingTarget)} ${remaining(m.bookings,s.bookingTarget)===1?'booking':'bookings'} to your goal. One conversation at a time.`;
  return `<section class="daily-signal" aria-label="Today’s progress"><div class="signal-heading"><p class="signal-eyebrow">TODAY’S PROGRESS</p><button class="signal-settings" data-action="settings">Edit targets <span aria-hidden="true">↗</span></button></div><div class="signal-composition">${bookingDial(m.bookings,s.bookingTarget)}<div class="signal-work"><div class="signal-status ${m.bookingGoalMet?'goal-met':''}"><span class="signal-status-mark" aria-hidden="true">${m.bookingGoalMet?'✓':'·'}</span><div><h2>${status}</h2><p>${escape(note)}</p></div></div>${track('Calls made',m.calls,s.callLimit,'call-track',m.calls>s.callLimit?`${m.calls-s.callLimit} beyond your usual limit. You chose to continue.`:m.callLimitReached?'Usual limit reached.':'Each mark is one call attempt. Stop early when your booking goal is met.')}${track('Leads reviewed',m.reviewed,s.reviewTarget,'review-track',m.reviewed>s.reviewTarget?'Your review target is complete.':remaining(m.reviewed,s.reviewTarget)?`${remaining(m.reviewed,s.reviewTarget)} more personal reviews to your target.`:'Your review target is complete.')}</div></div></section>`;
}

const outcomeNames={meeting_booked:'Meeting booked',follow_up:'Follow-up agreed',connected:'Connected',no_answer:'No answer',not_interested:'Not interested',wrong_number:'Wrong number'};
const outcomeKeys=Object.keys(outcomeNames);
const shortDate=value=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',day:'numeric',month:'short'}).format(new Date(value+'T12:00:00Z'));
function weeklyTrace(metrics,today){
  const days=metrics.daily||[],observed=days.filter(d=>d.date<=today),peak=Math.max(1,...observed.map(d=>d.calls));
  const rough=peak/3,magnitude=10**Math.floor(Math.log10(rough)),step=peak<=4?2:[1,2,5,10].find(n=>n*magnitude>=rough)*magnitude,ceiling=peak<=4?4:Math.ceil(peak/step)*step;
  const x=i=>52+i*78,y=n=>190-n/ceiling*154;
  const path=key=>observed.map((d,i)=>`${i?'L':'M'}${x(i)},${y(d[key])}`).join(' ');
  const grid=Array.from({length:Math.round(ceiling/step)+1},(_,i)=>i*step).map(n=>`<g><line x1="52" x2="520" y1="${y(n)}" y2="${y(n)}"/><text x="30" y="${y(n)+4}" text-anchor="end">${n}</text></g>`).join('');
  const nodes=observed.map((d,i)=>`<g><title>${escape(shortDate(d.date))}: ${d.calls} calls; ${d.bookings} distinct bookings</title><circle class="trace-call-point" cx="${x(i)}" cy="${y(d.calls)}" r="4"/><path class="trace-booking-point" d="M${x(i)},${y(d.bookings)-5}l5 5-5 5-5-5Z"/></g>`).join('');
  const labels=days.map((d,i)=>`<text class="${d.date>today?'future-label':''}" x="${x(i)}" y="222" text-anchor="middle">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i]}</text>`).join('');
  const empty=metrics.calls===0;
  return `<section class="weekly-trace" aria-labelledby="week-trace-title"><div class="visual-section-heading"><div><p class="signal-eyebrow">THE WEEK, DAY BY DAY</p><h2 id="week-trace-title">Your conversation rhythm</h2></div><div class="trace-legend"><span><i class="legend-line"></i>Calls</span><span><i class="legend-diamond"></i>Bookings</span></div></div><div class="trace-plot ${empty?'is-empty':''}"><svg viewBox="0 0 560 240" role="img" aria-label="Daily calls and distinct bookings, ${escape(shortDate(metrics.startDate))} to ${escape(shortDate(metrics.endDate))}. Exact counts are in the daily breakdown below."><g class="trace-grid">${grid}</g>${observed.length?`<path class="trace-calls" d="${path('calls')}"/><path class="trace-bookings" d="${path('bookings')}"/>${nodes}`:''}<g class="trace-labels">${labels}</g></svg>${empty?'<div class="trace-empty"><strong>Your first call starts the picture.</strong><span>Saved calls will appear here. Future days stay open.</span></div>':''}</div><details class="visual-data-details"><summary>Daily breakdown <span aria-hidden="true">↗</span></summary><div class="visual-table-wrap"><table><caption>Calls and distinct appointments · Lagos dates</caption><thead><tr><th scope="col">Day</th><th scope="col">Calls</th><th scope="col">Bookings</th></tr></thead><tbody>${days.map(d=>`<tr><th scope="row">${escape(shortDate(d.date))}${d.date>today?' · upcoming':''}</th><td>${d.date>today?'—':d.calls}</td><td>${d.date>today?'—':d.bookings}</td></tr>`).join('')}</tbody></table></div></details><p class="visual-footnote">Appointments count once per week, on the day first recorded. Future days are not zeroes.</p></section>`;
}
function outcomeMosaic(metrics){
  const unit=Math.max(1,Math.ceil(metrics.calls/120));
  const marks=outcomeKeys.flatMap(key=>Array.from({length:Math.ceil((metrics.outcomes[key]||0)/unit)},()=>`<i class="outcome-dot outcome-${key}"></i>`)).join('');
  return `<section class="outcome-visual" aria-labelledby="outcome-title"><div class="visual-section-heading"><div><p class="signal-eyebrow">THE OUTCOME OF EACH ATTEMPT</p><h2 id="outcome-title">How calls ended</h2></div></div><div class="outcome-mosaic ${metrics.calls?'':'is-empty'}" aria-hidden="true">${marks||Array.from({length:36},()=>'<i class="outcome-dot empty-dot"></i>').join('')}</div><p class="visual-footnote">${metrics.calls?(unit===1?'One mark · one saved call.':`One mark · up to ${unit} calls. Exact counts below.`):'No outcomes recorded in this week yet.'}</p><dl class="outcome-legend">${outcomeKeys.map(key=>`<div><dt><i class="outcome-dot outcome-${key}" aria-hidden="true"></i>${outcomeNames[key]}</dt><dd>${metrics.outcomes[key]||0}</dd></div>`).join('')}</dl></section>`;
}
export function weeklyVisuals(metrics,today){
  const rate=metrics.bookingRate===null?'—':(metrics.bookingRate*100).toFixed(1)+'%';
  return `<section class="weekly-picture" aria-label="Weekly activity overview"><div class="week-totals"><div><span>Call attempts</span><strong>${metrics.calls}</strong></div><div><span>Conversations recorded</span><strong>${metrics.connected}</strong></div><div><span>Distinct bookings</span><strong>${metrics.bookings}</strong></div><div class="week-rate"><span>Bookings per attempt</span><strong>${rate}</strong></div></div><div class="weekly-visual-grid">${weeklyTrace(metrics,today)}${outcomeMosaic(metrics)}</div><p class="visual-footnote">Counts reflect your saved outcomes. ${metrics.transcripts} ${metrics.transcripts===1?'transcript':'transcripts'} available for review.</p></section>`;
}
