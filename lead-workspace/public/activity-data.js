// Seven-day counts derived from saved Lagos call dates.
export function weeklySeries(calls,startDate,endDate){
  const days=Array.from({length:7},(_,i)=>{const d=new Date(startDate+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return {date:d.toISOString().slice(0,10),calls:0,bookings:0};}),map=new Map(days.map(d=>[d.date,d])),seen=new Set();
  const selected=calls.filter(c=>c.date>=startDate&&c.date<=endDate).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id));
  for(const c of selected){const day=map.get(c.date);if(!day)continue;day.calls++;if(c.outcome==='meeting_booked'&&c.meetingAt){const key=c.leadId+'|'+c.meetingAt;if(!seen.has(key)){seen.add(key);day.bookings++;}}}
  return days;
}
