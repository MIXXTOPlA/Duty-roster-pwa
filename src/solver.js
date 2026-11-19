import {SHIFTS,REQUIRED_ROLES,OPTIONAL_ROLES,eligible,shiftInterval} from './model.js';
import {validateRoster} from './validate.js';
import {analyzeFairness} from './metrics.js';

// Fast, bounded baseline scheduler. Not a mathematical optimizer.
export async function generateRoster(input,{limitMs=60000}={}){
 const started=Date.now();
 if(!input||!Array.isArray(input.people)||!Array.isArray(input.assignments||[])||!Array.isArray(input.restrictions||[])||!Array.isArray(input.history||[]))throw Error('잘못된 입력');
 const monday=new Date(input.mondayISO+'T00:00:00Z');
 if(!Number.isFinite(monday.getTime())||monday.getUTCDay()!==1)throw Error('월요일 날짜가 필요합니다');
 const people=input.people,byId=new Map(people.map(p=>[p.id,p]));
 const fixed=(input.assignments||[]).map(a=>({...a,locked:true}));
 const fixedCheck=validateRoster({...input,assignments:fixed});
 if(fixedCheck.errors.length)throw Error('고정 근무 또는 입력 제약이 충돌합니다: '+fixedCheck.errors[0].code);
 const slots=[];
 for(let day=0;day<8;day++)for(let shift=0;shift<5;shift++)for(const role of REQUIRED_ROLES)
   if(!fixed.some(a=>a.day===day&&a.shift===shift&&a.role===role))slots.push({day,shift,role,seq:day*5+shift});
 const restrictions=input.restrictions||[];
 const intervals=Array.from({length:40},(_,seq)=>{
   const day=Math.floor(seq/5),shift=seq%5;
   const date=new Date(monday.getTime()+day*86400000).toISOString().slice(0,10);
   return shiftInterval(date,SHIFTS[shift].id);
 });
 const blocked=new Map(people.map(p=>[p.id,intervals.map(iv=>restrictions.some(r=>{
   if(r.personId!==p.id)return false;
   const a=Date.parse(r.start+'Z'),b=Date.parse(r.end+'Z');
   return Number.isFinite(a)&&Number.isFinite(b)&&iv.start<b&&a<iv.end;
 }))]));
 const history=new Map(people.map(p=>[p.id,(input.history||[]).filter(h=>h.personId===p.id).map(h=>h.seq)]));
 const counts=new Map(people.map(p=>[p.id,0]));
 let best=fixed,completed=false,attempts=0;
 const deadline=started+Math.min(limitMs,4000);
 for(let attempt=0;attempt<120&&Date.now()<deadline;attempt++){
   attempts++;
   const current=fixed.map(a=>({...a}));
   const occupied=new Map(people.map(p=>[p.id,[...history.get(p.id)]]));
   const tally=new Map(counts);
   for(const a of fixed){occupied.get(a.personId)?.push(a.day*5+a.shift);tally.set(a.personId,(tally.get(a.personId)||0)+1);}
   // Vary tie breaks between attempts without unbounded backtracking.
   for(const slot of slots){
     const options=people.filter(p=>eligible(p,slot.role)&&!blocked.get(p.id)[slot.seq]&&occupied.get(p.id).every(s=>Math.abs(s-slot.seq)>=3));
     if(!options.length)break;
     options.sort((a,b)=>{
       const score=p=>{
         const n=tally.get(p.id),seqs=occupied.get(p.id),nearest=seqs.length?Math.min(...seqs.map(s=>Math.abs(s-slot.seq))):20;
         const substitution=(slot.role==='rifle'||slot.role==='m60')?(p.baseRole==='rifle'?0:p.baseRole==='driver'?10:20):0;
         const weekly=n>=9?20:0;
         const threeGap=nearest===3?3:0;
         const tie=((p.id.length*31+p.id.charCodeAt(0)*13+attempt*17+slot.seq*7)%19)/19;
         return n*9+substitution+weekly+threeGap+tie*(attempt%5+1)*2;
       };
       return score(a)-score(b)||a.id.localeCompare(b.id);
     });
     const pick=options[(attempt%11===0&&options.length>1)?1:0];
     current.push({day:slot.day,shift:slot.shift,role:slot.role,personId:pick.id});
     occupied.get(pick.id).push(slot.seq);
     tally.set(pick.id,tally.get(pick.id)+1);
   }
   if(current.length>best.length)best=current;
   if(current.length===fixed.length+slots.length){
     const verified=validateRoster({...input,assignments:current});
     if(verified.valid){best=current;completed=true;break;}
   }
 }
 // Optional roles deliberately left empty until mandatory roster is verified.
 const validation=validateRoster({...input,assignments:best});
 const status=completed&&validation.valid?'complete':'partial';
 return {status,assignments:best,validation,
  fairness:analyzeFairness(best,people,input.history||[]),
  engine:'bounded-js-greedy',optimal:false,attempts,elapsedMs:Date.now()-started,
  message:status==='complete'?'필수 근무 편성 완료':'부분 편성: 탐색 한계 내에서 완성하지 못함. 실제 근무에 사용 금지'};
}