import {SHIFTS} from './model.js';

// Soft-constraint diagnostics; never overrides hard-rule validation.
export function analyzeFairness(assignments, people, history=[]) {
 const ordered = [...history.map(h=>({...h, historical:true})), ...assignments.map(a=>({...a,seq:a.day*5+a.shift}))];
 const perPerson = people.map(p=>{
  const current=assignments.filter(a=>a.personId===p.id&&a.day<7);
  const duties=ordered.filter(a=>a.personId===p.id&&Number.isInteger(a.seq)).sort((a,b)=>a.seq-b.seq);
  let threeGaps=0, rewarded=0, unrewarded=0;
  for(let i=1;i<duties.length;i++){
   const prev=duties[i-1], next=duties[i];
   if(next.seq-prev.seq!==3 || next.role==='radio'||next.role==='reserveDriver')continue;
   threeGaps++;
   const after=duties[i+1];
   if(!after)continue;
   const gap=after.seq-next.seq;
   if((after.role==='radio'||after.role==='reserveDriver')?gap>=3:gap>=5)rewarded++;
   else unrewarded++;
  }
  return {personId:p.id,weekCount:current.length,nightCount:current.filter(a=>a.shift>=3).length,
   hours:current.reduce((sum,a)=>sum+SHIFTS[a.shift].durationMinutes/60,0),
   threeGaps,rewarded,unrewarded};
 });
 const nights=perPerson.map(p=>p.nightCount);
 return {perPerson,nightSpread:Math.max(...nights)-Math.min(...nights),
  unrewardedTotal:perPerson.reduce((s,p)=>s+p.unrewarded,0),
  weeklyCountSpread:Math.max(...perPerson.map(p=>p.weekCount))-Math.min(...perPerson.map(p=>p.weekCount))};
}