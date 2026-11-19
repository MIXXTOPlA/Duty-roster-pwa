import {SHIFTS,REQUIRED_ROLES,OPTIONAL_ROLES,eligible,shiftInterval} from './model.js';
import {validateRoster} from './validate.js';
import {analyzeFairness} from './metrics.js';
import {repairPartial} from './repair.js';

// Portable JavaScript feasibility baseline. WASM optimizer is NOT connected.
export async function generateRoster(input,{limitMs=60000}={}){
 if(limitMs!==60000)throw new Error('MVP generation time limit is 60000 ms');
 const inputErrors=validateInput(input);
 if(inputErrors.length)return {status:'invalid-input',errors:inputErrors};
 const check=validateRoster(input);
 if(check.errors.length)return {status:'invalid-input',...check};
 const people=input.people;
 const fixed=(input.assignments||[]).map(a=>({...a,locked:true}));
 const restrictions=input.restrictions||[];
 const history=input.history||[];
 const started=Date.now();
 const isoForDay=d=>new Date(Date.parse(input.mondayISO+'T00:00:00Z')+d*86400000).toISOString().slice(0,10);
 const intervals=Array.from({length:40},(_,seq)=>shiftInterval(isoForDay(Math.floor(seq/5)),SHIFTS[seq%5].id));
 const blocked=new Map();
 for(const p of people){blocked.set(p.id,intervals.map(iv=>restrictions.some(r=>r.personId===p.id&&iv.start<Date.parse(r.end+'Z')&&Date.parse(r.start+'Z')<iv.end)));}
 const lockedKeys=new Set(fixed.map(a=>`${a.day}/${a.shift}/${a.role}`));
 const targets=[];
 for(let seq=0;seq<40;seq++)for(const role of REQUIRED_ROLES){const day=Math.floor(seq/5),shift=seq%5;if(!lockedKeys.has(`${day}/${shift}/${role}`))targets.push({day,shift,role,seq});}
 const baseCounts=new Map(people.map(p=>[p.id,0]));
 const baseSeqs=new Map(people.map(p=>[p.id,[]]));
 for(const h of history){if(baseSeqs.has(h.personId))baseSeqs.get(h.personId).push(h.seq);}
 for(const a of fixed){baseSeqs.get(a.personId).push(a.day*5+a.shift);baseCounts.set(a.personId,baseCounts.get(a.personId)+1);}
 let best=null;
 for(let attempt=0;attempt<180&&Date.now()-started<Math.min(limitMs,5000);attempt++){
  const seqs=new Map([...baseSeqs].map(([k,v])=>[k,[...v]]));
  const counts=new Map(baseCounts);const assigned=[...fixed];let failed=false;
  for(const t of targets){
   const candidates=people.filter(p=>eligible(p,t.role)&&!blocked.get(p.id)[t.seq]&&seqs.get(p.id).every(s=>Math.abs(s-t.seq)>=3));
   if(!candidates.length){failed=true;break;}
   const rank={leader:0,driver:1,rifle:2};
   candidates.sort((a,b)=>{
    const score=p=>{const ss=seqs.get(p.id);const nearest=ss.length?Math.min(...ss.map(s=>Math.abs(s-t.seq))):20;
     const rolePenalty=(t.role==='m60'||t.role==='rifle')?rank[p.baseRole]*5:0;
     const futureCapacity=ss.filter(s=>s>t.seq).length;
     return counts.get(p.id)*12+rolePenalty+futureCapacity*3+(nearest===3?6:0)+((p.intake||0)%17)*0.001;};
    return score(a)-score(b)||((a.id.charCodeAt(0)*31+Number(a.id.slice(1))*13+attempt*7)%23)-((b.id.charCodeAt(0)*31+Number(b.id.slice(1))*13+attempt*7)%23);
   });
   const pick=candidates[attempt%7===0&&candidates.length>1?1:0];
   seqs.get(pick.id).push(t.seq);counts.set(pick.id,counts.get(pick.id)+1);
   assigned.push({day:t.day,shift:t.shift,role:t.role,personId:pick.id});
  }
  if(!best||assigned.length>best.length)best=assigned;
  if(!failed){const verified=validateRoster({...input,assignments:assigned});if(verified.valid){const improved=improveFairness(assigned,input,blocked,started);const finalCheck=validateRoster({...input,assignments:improved});if(!finalCheck.valid)continue;return {status:'complete',assignments:improved,validation:finalCheck,stats:summarize(improved,people),fairness:analyzeFairness(improved,people,history),engine:'js-heuristic',optimal:false,elapsedMs:Date.now()-started};}}
 }
 const repaired=repairPartial(input,best||fixed,{deadline:started+Math.min(limitMs,9000)});
 if(repaired.complete){const a=repaired.assignments;return {status:'complete',assignments:a,validation:repaired.validation,stats:summarize(a,people),fairness:analyzeFairness(a,people,history),engine:'js-heuristic-plus-bounded-repair',optimal:false,repairNodes:repaired.nodes,elapsedMs:Date.now()-started};}
 const candidate=repaired.assignments.length>(best||fixed).length?repaired.assignments:(best||fixed);
 const verified=validateRoster({...input,assignments:candidate});
 return {status:'partial',assignments:candidate,validation:verified,stats:summarize(candidate,people),fairness:analyzeFairness(candidate,people,history),engine:'js-heuristic',optimal:false,elapsedMs:Date.now()-started,message:'No complete solution found by heuristic; not proof of infeasibility'};
}
export function summarize(assignments,people){return people.map(p=>{const a=assignments.filter(x=>x.personId===p.id);return {personId:p.id,total:a.length,weekCount:a.filter(x=>x.day<7).length,night:a.filter(x=>x.day<7&&(x.shift===3||x.shift===4)).length,hours:a.reduce((n,x)=>n+SHIFTS[x.shift].durationMinutes/60,0)};});}
function improveFairness(initial,input,blocked,started){
 const people=input.people;const assignments=initial.map(a=>({...a}));
 const personById=new Map(people.map(p=>[p.id,p]));
 const history=new Map(people.map(p=>[p.id,(input.history||[]).filter(h=>h.personId===p.id).map(h=>h.seq)]));
 const counts=new Map(people.map(p=>[p.id,0]));
 const nights=new Map(people.map(p=>[p.id,0]));
 const seqOf=a=>a.day*5+a.shift;
 for(const a of assignments)if(a.day<7){counts.set(a.personId,counts.get(a.personId)+1);if(a.shift>=3)nights.set(a.personId,nights.get(a.personId)+1);}
 const available=(p,seq,except)=>!blocked.get(p.id)[seq]&&history.get(p.id).every(s=>Math.abs(s-seq)>=3)&&assignments.every((a,i)=>i===except||a.personId!==p.id||Math.abs(seqOf(a)-seq)>=3);
 const totalNight=[...nights.values()].reduce((a,b)=>a+b,0);const nightTarget=totalNight/people.length;
 const cost=p=>{const c=counts.get(p.id),n=nights.get(p.id);return Math.pow(c-8,2)*10+Math.pow(n-nightTarget,2)*4;};
 const rewardPenalty=personId=>{const duties=[...history.get(personId).map(seq=>({seq,role:'rifle'})),...assignments.filter(a=>a.personId===personId).map(a=>({seq:seqOf(a),role:a.role}))].sort((a,b)=>a.seq-b.seq);let penalty=0;for(let j=1;j+1<duties.length;j++){const prev=duties[j-1],cur=duties[j],next=duties[j+1];if(cur.seq-prev.seq===3&&!OPTIONAL_ROLES.includes(cur.role)&&!OPTIONAL_ROLES.includes(next.role)&&next.seq-cur.seq<5)penalty++;}return penalty;};
 for(let pass=0;pass<12&&Date.now()-started<4000;pass++){
  let changes=0;
  for(let i=0;i<assignments.length;i++){
   const a=assignments[i];if(a.locked||a.day>=7)continue;
   const seq=seqOf(a),old=personById.get(a.personId),night=a.shift>=3;
   let best=null,bestDelta=-0.00001;
   for(const p of people){if(p.id===old.id||!eligible(p,a.role)||!available(p,seq,i))continue;
    const before=cost(old)+cost(p)+3*(rewardPenalty(old.id)+rewardPenalty(p.id));
    counts.set(old.id,counts.get(old.id)-1);counts.set(p.id,counts.get(p.id)+1);
    if(night){nights.set(old.id,nights.get(old.id)-1);nights.set(p.id,nights.get(p.id)+1);}
    a.personId=p.id;const after=cost(old)+cost(p)+3*(rewardPenalty(old.id)+rewardPenalty(p.id));a.personId=old.id;
    const delta=before-after;
    counts.set(old.id,counts.get(old.id)+1);counts.set(p.id,counts.get(p.id)-1);
    if(night){nights.set(old.id,nights.get(old.id)+1);nights.set(p.id,nights.get(p.id)-1);}
    if(delta>bestDelta){bestDelta=delta;best=p;}
   }
   if(best){counts.set(old.id,counts.get(old.id)-1);counts.set(best.id,counts.get(best.id)+1);if(night){nights.set(old.id,nights.get(old.id)-1);nights.set(best.id,nights.get(best.id)+1);}a.personId=best.id;changes++;}
  }if(!changes)break;
 }
 for(let pass=0;pass<3&&Date.now()-started<4500;pass++){
  let added=0;
  for(let seq=0;seq<35;seq++){const day=Math.floor(seq/5),shift=seq%5;
   for(const role of OPTIONAL_ROLES){
    if(assignments.some(a=>a.day===day&&a.shift===shift&&a.role===role))continue;
    const candidates=people.filter(p=>counts.get(p.id)<8&&eligible(p,role)&&available(p,seq,-1));
    candidates.sort((a,b)=>counts.get(a.id)-counts.get(b.id)||nights.get(a.id)-nights.get(b.id)||a.intake-b.intake);
    if(!candidates.length)continue;
    const p=candidates[0];assignments.push({day,shift,role,personId:p.id});counts.set(p.id,counts.get(p.id)+1);if(shift>=3)nights.set(p.id,nights.get(p.id)+1);added++;
   }
  }if(!added)break;
 }
 return assignments;
}
export function validateInput(input){
 const errors=[];
 if(!input||!Array.isArray(input.people)||!Array.isArray(input.assignments||[])||!Array.isArray(input.restrictions||[])||!Array.isArray(input.history||[]))return [{code:'INVALID_INPUT'}];
 const d=new Date(input.mondayISO+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.mondayISO||'')||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==input.mondayISO||d.getUTCDay()!==1)errors.push({code:'INVALID_MONDAY'});
 const ids=new Set();
 for(const p of input.people){if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||!['leader','driver','rifle'].includes(p.baseRole))errors.push({code:'INVALID_PERSON',personId:p?.id});else ids.add(p.id);}
 for(const r of input.restrictions||[]){const start=Date.parse(r.start+'Z'),end=Date.parse(r.end+'Z');if(!ids.has(r.personId)||!Number.isFinite(start)||!Number.isFinite(end)||start>=end)errors.push({code:'INVALID_RESTRICTION',restriction:r});}
 for(const h of input.history||[]){if(!ids.has(h.personId)||!Number.isInteger(h.seq)||h.seq>=0)errors.push({code:'INVALID_HISTORY',history:h});}
 return errors;
}