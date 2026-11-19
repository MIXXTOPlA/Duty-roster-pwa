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
     // Role substitution is exceptional, not a soft fairness preference.
     // Rifle at 4+ gaps > driver at 4+ > leader at 4+ > rifle at 3.
     // A driver/leader at gap 3 may never substitute for a rifle specialist.
     const gapOf=p=>Math.min(20,...occupied.get(p.id).map(s=>Math.abs(s-slot.seq)));
     const isRifleSlot=slot.role==='rifle'||slot.role==='m60';
     const tier=p=>{
       if(!isRifleSlot)return gapOf(p)>=4?0:1;
       const gap=gapOf(p);
       if(p.baseRole==='rifle')return gap>=4?0:3;
       if(gap<4)return 10;
       return p.baseRole==='driver'?1:2;
     };
     const minTier=Math.min(...options.map(tier));
     const preferred=options.filter(p=>tier(p)===minTier);
     preferred.sort((a,b)=>{
       const score=p=>{
         const n=tally.get(p.id),nearest=gapOf(p);
         const weekly=n>=9?20:0;
         const gapPenalty=nearest===3?16:nearest===4?0:nearest===5?3:nearest===6?5:nearest>6?7:0;
         const tie=((p.id.length*31+p.id.charCodeAt(0)*13+attempt*17+slot.seq*7)%19)/19;
         return n*9+weekly+gapPenalty+tie*(attempt%5+1)*2;
       };
       return score(a)-score(b)||a.id.localeCompare(b.id);
     });
     const pick=preferred[(attempt%11===0&&preferred.length>1)?1:0];
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
 if(completed){
   best=fillOptionalSlots(best,people,blocked,history,started,Math.min(limitMs,4000));
   best=balanceRoster(best,people,blocked,history,started,Math.min(limitMs,4000));
 }
 // Optional assignments are accepted only when all hard constraints still pass.
 const validation=validateRoster({...input,assignments:best});
 const status=completed&&validation.valid?'complete':'partial';
 return {status,assignments:best,validation,
  fairness:analyzeFairness(best,people,input.history||[]),
  engine:'bounded-js-role-priority-v2',optimal:false,attempts,elapsedMs:Date.now()-started,
  message:status==='complete'?'필수 근무 편성 완료':'부분 편성: 탐색 한계 내에서 완성하지 못함. 실제 근무에 사용 금지'};
}
function balanceRoster(initial,people,blocked,history,started,budgetMs){
 const roster=initial.map(a=>({...a})), byId=new Map(people.map(p=>[p.id,p]));
 const duration=a=>SHIFTS[a.shift].durationMinutes;
 const seq=a=>a.day*5+a.shift;
 const fixed=new Set(roster.map((a,i)=>a.locked?i:-1).filter(i=>i>=0));
 const ids=people.map(p=>p.id);
 const targetWeekly=roster.filter(a=>a.day<7).length/Math.max(1,people.length);
 const targetHours=roster.reduce((s,a)=>s+duration(a),0)/Math.max(1,people.length);
 const targetNight=roster.filter(a=>a.day<7&&a.shift>=3).length/Math.max(1,people.length);
 function score(){
  const stats=new Map(ids.map(id=>[id,{week:0,hours:0,night:0,seqs:[]}]));
  for(const a of roster){const st=stats.get(a.personId);if(!st)continue;
   st.hours+=duration(a);if(a.day<7){st.week++;if(a.shift>=3)st.night++;}st.seqs.push({seq:seq(a),role:a.role});}
  let total=0;
  for(const a of roster){if(a.role==='rifle'||a.role==='m60'){const base=byId.get(a.personId)?.baseRole;if(base==='driver')total+=450;else if(base==='leader')total+=900;}}
  for(const st of stats.values()){
   total+=12*(st.week-targetWeekly)**2+0.0004*(st.hours-targetHours)**2+8*(st.night-targetNight)**2;
   st.seqs.sort((a,b)=>a.seq-b.seq);
   for(let i=1;i<st.seqs.length;i++){
    const gap=st.seqs[i].seq-st.seqs[i-1].seq;
    if(gap===3)total+=18;
    else if(gap===5)total+=3;
    else if(gap===6)total+=6;
    else if(gap>6)total+=Math.min(18,7+(gap-7)*2);
    if(OPTIONAL_ROLES.includes(st.seqs[i-1].role)&&OPTIONAL_ROLES.includes(st.seqs[i].role))total+=1500;
    if(i>=2&&st.seqs[i-1].seq-st.seqs[i-2].seq===3&&gap<5&&
      !OPTIONAL_ROLES.includes(st.seqs[i].role))total+=6;
   }
  }
  return total;
 }
 function allowed(personId,slot,skipA,skipB){
  const p=byId.get(personId),index=seq(slot);
  if(!p||!eligible(p,slot.role)||blocked.get(personId)?.[index])return false;
  if((history.get(personId)||[]).some(n=>Math.abs(n-index)<3))return false;
  return roster.every((a,i)=>i===skipA||i===skipB||a.personId!==personId||Math.abs(seq(a)-index)>=3);
 }
 let bestScore=score(),changes=0;
 for(let pass=0;pass<5&&Date.now()-started<budgetMs;pass++){
  let improved=false;
  for(let i=0;i<roster.length&&Date.now()-started<budgetMs;i++){
   if(fixed.has(i))continue;
   const a=roster[i],oldId=a.personId;
   let winner=null,winnerScore=bestScore;
   for(const p of people){
    if(p.id===oldId||!allowed(p.id,a,i,-1))continue;
    a.personId=p.id;
    const candidate=score();
    if(candidate<winnerScore-0.0001){winnerScore=candidate;winner=p.id;}
    a.personId=oldId;
   }
   if(winner){a.personId=winner;bestScore=winnerScore;changes++;improved=true;}
  }
  if(!improved)break;
 }
 return roster;
}

function fillOptionalSlots(initial,people,blocked,history,started,budgetMs){
 const roster=initial.map(a=>({...a})),byId=new Map(people.map(p=>[p.id,p]));
 const index=a=>a.day*5+a.shift;
 const gapCost=gap=>gap===4?0:gap===3?32:gap===5?5:gap===6?14:gap===7?25:gap>=8?38+(gap-8)*7:120;
 const occupiedSlots=new Set(roster.map(a=>`${a.day}/${a.shift}/${a.role}`));
 const slots=[];
 for(let day=0;day<8;day++)for(let shift=0;shift<5;shift++)for(const role of OPTIONAL_ROLES){
  if(!occupiedSlots.has(`${day}/${shift}/${role}`))slots.push({day,shift,role});
 }
 const assignments=new Map(people.map(p=>[p.id,roster.filter(a=>a.personId===p.id).map(a=>({seq:index(a),role:a.role}))]));
 const histories=new Map(people.map(p=>[p.id,[...(history.get(p.id)||[])]]));
 const weekly=new Map(people.map(p=>[p.id,roster.filter(a=>a.personId===p.id&&a.day<7).length]));
 const nights=new Map(people.map(p=>[p.id,roster.filter(a=>a.personId===p.id&&a.day<7&&a.shift>=3).length]));
 const totalNight=roster.filter(a=>a.day<7&&a.shift>=3).length;
 const nightTarget=(totalNight+15)/people.length;
 const deltaFor=(p,slot)=>{
  if(!eligible(p,slot.role)||blocked.get(p.id)?.[index(slot)])return Infinity;
  const seq=index(slot),current=assignments.get(p.id),all=[...current.map(a=>a.seq),...histories.get(p.id)].sort((a,b)=>a-b);
  if(all.some(x=>Math.abs(x-seq)<3))return Infinity;
  const prevDuty=current.filter(a=>a.seq<seq).sort((a,b)=>b.seq-a.seq)[0];
  const nextDuty=current.filter(a=>a.seq>seq).sort((a,b)=>a.seq-b.seq)[0];
  // Optional duties are exceptional: do not chain two optional duties for the same person.
  if((prevDuty&&OPTIONAL_ROLES.includes(prevDuty.role))||(nextDuty&&OPTIONAL_ROLES.includes(nextDuty.role)))return Infinity;
  const before=all.filter(x=>x<seq).at(-1),after=all.find(x=>x>seq);
  let delta=0;
  if(before!==undefined&&after!==undefined)delta-=gapCost(after-before);
  if(before!==undefined)delta+=gapCost(seq-before);
  if(after!==undefined)delta+=gapCost(after-seq);
  const count=weekly.get(p.id),add=slot.day<7?1:0;
  delta+=20*((count+add-8.35)**2-(count-8.35)**2);
  if(add&&count>=9)delta+=60;
  if(slot.day>=7)delta+=7;
  if(add&&slot.shift>=3){
   const n=nights.get(p.id);
   delta+=4*((n+1-nightTarget)**2-(n-nightTarget)**2);
  }
  // Extra optional duties should justify their burden through better spacing/fairness.
  delta+=7;
  // Keep reserve-driver assignments for drivers, and prefer rifle specialists for radio.
  if(slot.role==='radio'&&p.baseRole==='leader')delta+=3;
  if(slot.role==='radio'&&p.baseRole==='driver')delta+=2;
  return delta;
 };
 for(let n=0;n<slots.length&&Date.now()-started<budgetMs;n++){
  let best=null,bestDelta=-0.001;
  for(const slot of slots){
   if(occupiedSlots.has(`${slot.day}/${slot.shift}/${slot.role}`))continue;
   for(const p of people){
    const delta=deltaFor(p,slot);
    if(delta<bestDelta){bestDelta=delta;best={slot,p};}
   }
  }
  if(!best)break;
  const {slot,p}=best;
  roster.push({...slot,personId:p.id});
  occupiedSlots.add(`${slot.day}/${slot.shift}/${slot.role}`);
  assignments.get(p.id).push({seq:index(slot),role:slot.role});
  if(slot.day<7)weekly.set(p.id,weekly.get(p.id)+1);
  if(slot.day<7&&slot.shift>=3)nights.set(p.id,nights.get(p.id)+1);
 }
 return roster;
}
