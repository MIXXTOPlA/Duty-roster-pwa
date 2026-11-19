import {SHIFTS,REQUIRED_ROLES,OPTIONAL_ROLES,eligible,shiftInterval,allowedBeforeLeave,leaveOutRule} from './model.js?v=211';
import {validateRoster} from './validate.js?v=211';
import {analyzeFairness} from './metrics.js';

// Whole-roster iterative optimization. Hard constraints are never traded for score.
export async function generateRoster(input,{limitMs=60000}={}){
 const started=Date.now(),deadline=started+Math.min(limitMs,10500),optionalDeadline=started+Math.min(limitMs,14000);
 if(!input||!Array.isArray(input.people)||!Array.isArray(input.assignments||[])||!Array.isArray(input.restrictions||[])||!Array.isArray(input.history||[]))throw Error('잘못된 입력');
 const monday=new Date(input.mondayISO+'T00:00:00Z');
 if(!Number.isFinite(monday.getTime())||monday.getUTCDay()!==1)throw Error('월요일 날짜가 필요합니다');
 const people=input.people,byId=new Map(people.map(p=>[p.id,p]));
 const fixed=(input.assignments||[]).map(a=>({...a,locked:true}));
 const check=validateRoster({...input,assignments:fixed});
 if(check.errors.length)throw Error('고정 근무 충돌: '+check.errors[0].code);
 const intervals=Array.from({length:40},(_,q)=>shiftInterval(new Date(monday.getTime()+Math.floor(q/5)*86400000).toISOString().slice(0,10),SHIFTS[q%5].id));
 const blocked=new Map(people.map(p=>[p.id,intervals.map(iv=>(input.restrictions||[]).some(r=>{
  if(r.personId!==p.id)return false;
  const a=Date.parse(r.start+'Z'),b=Date.parse(r.end+'Z');
  return Number.isFinite(a)&&Number.isFinite(b)&&iv.start<b&&a<iv.end;
 }))]));
 const history=new Map(people.map(p=>[p.id,(input.history||[]).filter(h=>h.personId===p.id&&Number.isInteger(h.seq)).map(h=>h.seq)]));
 const slots=[];
 for(let day=0;day<8;day++)for(let shift=0;shift<5;shift++)for(const role of REQUIRED_ROLES)
  if(!fixed.some(a=>a.day===day&&a.shift===shift&&a.role===role))slots.push({day,shift,role});
 const seq=a=>a.day*5+a.shift;
 const substitution=(p,role)=>role==='rifle'||role==='m60'?(p.baseRole==='rifle'?0:p.baseRole==='driver'?900:1800):0;
 const available=(p,a,roster,skip1=-1,skip2=-1)=>{
  const q=seq(a);
  return eligible(p,a.role)&&!blocked.get(p.id)[q]&&allowedBeforeLeave(input.mondayISO,input.restrictions||[],p.id,a.day,a.shift)&&
   !(history.get(p.id)||[]).some(x=>Math.abs(x-q)<3)&&
   roster.every((x,i)=>i===skip1||i===skip2||x.personId!==p.id||Math.abs(seq(x)-q)>=3);
 };
 const score=roster=>{
  const grouped=new Map(people.map(p=>[p.id,[...(history.get(p.id)||[]).filter(q=>q<0).map(q=>({q,role:'history'}))]]));
  let total=0;
  for(const a of roster){grouped.get(a.personId)?.push({q:seq(a),role:a.role});total+=substitution(byId.get(a.personId),a.role);}
  const target=roster.filter(a=>a.day<7).length/Math.max(1,people.length);
  for(const p of people){
   const all=grouped.get(p.id).sort((a,b)=>a.q-b.q);
   const within=all.filter(x=>x.q>=0);
   const count=within.filter(x=>x.q<35).length;
   for(const rule of leaveOutRule(input.mondayISO,input.restrictions||[],p.id)){
    if(rule.outDay<0||rule.outDay>7)continue;
    const out=within.some(x=>Math.floor(x.q/5)===rule.outDay&&x.q%5<=2);
    if(!out)total+=3000;
   }
   total+=12*(count-target)**2;
   const first=within[0]?.q,last=within.at(-1)?.q;
   // An available person must not disappear at the start or end.
   if(first!==undefined){
    let prefix=0;for(let q=0;q<first;q++)if(!blocked.get(p.id)[q])prefix++;
    if(prefix>5)total+=45*(prefix-5)**2;
    let suffix=0;for(let q=last+1;q<40;q++)if(!blocked.get(p.id)[q])suffix++;
    if(suffix>5)total+=45*(suffix-5)**2;
   }else{
    const availableCount=blocked.get(p.id).filter(x=>!x).length;
    if(availableCount>=8)total+=200000;
   }
   for(let i=1;i<all.length;i++){
    const prev=all[i-1],cur=all[i],gap=cur.q-prev.q;
    // Do not penalize gaps mostly caused by leave.
    let free=0;for(let q=prev.q+1;q<cur.q&&q>=0&&q<40;q++)if(!blocked.get(p.id)[q])free++;
    if(gap===3)total+=60;
    else if(gap===4){}else if(gap===5)total+=110;
    else if(gap===6)total+=145;
    else if(gap>6&&free>=5)total+=175+(gap-7)*45;
    if(i>=2&&gap===3&&prev.q-all[i-2].q===3)total+=850;
    if(i>=2&&gap===5&&prev.q-all[i-2].q===3)total-=12;
   }
  }
  return total;
 };
 let best=fixed,completed=false,attempts=0,bestScore=Infinity;
 for(let attempt=0;attempt<100&&Date.now()<deadline;attempt++){
  attempts++;
  const roster=fixed.map(a=>({...a}));
  const occupied=new Map(people.map(p=>[p.id,[...history.get(p.id),...fixed.filter(a=>a.personId===p.id).map(seq)]]));
  const counts=new Map(people.map(p=>[p.id,fixed.filter(a=>a.personId===p.id).length]));
  for(const slot of slots){
   const q=seq(slot);
   const options=people.filter(p=>available(p,slot,roster));
   if(!options.length)break;
   const priority=p=>{
    const previous=occupied.get(p.id).filter(x=>x<q).sort((a,b)=>b-a);
    const gap=previous.length?q-previous[0]:4;
    const consecutive=previous.length>1&&gap===3&&previous[0]-previous[1]===3;
    const base=substitution(p,slot.role);
    // Rotate early: penalize first duty occurring late even with no previous duty.
    const idle=previous.length?Math.max(0,gap-5):Math.max(0,q-4);
    const gapCost=gap===4?0:gap===3?60:gap===5?110:gap===6?145:gap>6?175+(gap-7)*45:0;
    const tie=((p.id.length*19+p.id.charCodeAt(0)*7+attempt*31+q*13)%31)/31;
    const outBonus=leaveOutRule(input.mondayISO,input.restrictions||[],p.id).some(r=>r.outDay===slot.day&&slot.shift<=2)?-3000:0;
    return base+outBonus+gapCost+idle*idle*35+(consecutive?850:0)+(counts.get(p.id)||0)*9+tie*(attempt%7+1)*2;
   };
   options.sort((a,b)=>priority(a)-priority(b)||a.id.localeCompare(b.id));
   const pick=options[0];
   roster.push({...slot,personId:pick.id});
   occupied.get(pick.id).push(q);counts.set(pick.id,counts.get(pick.id)+1);
  }
  if(roster.length>best.length&&!completed)best=roster;
  if(roster.length!==fixed.length+slots.length)continue;
  const valid=validateRoster({...input,assignments:roster});
  if(!valid.valid)continue;
  completed=true;
  const improved=optimize(roster,people,available,score,deadline);
  const value=score(improved);
  if(value<bestScore){best=improved;bestScore=value;}
 }
 if(completed){
  // Repair uncovered personnel before considering optional duties.
  best=repairUnassigned(best,people,blocked,available,score,deadline);
  best=fillOptionalSlots(best,people,blocked,history,input.mondayISO,input.restrictions||[],optionalDeadline);
 }
 const validation=validateRoster({...input,assignments:best});
 const status=completed&&validation.valid?'complete':'partial';
 return {status,assignments:best,validation,fairness:analyzeFairness(best,people,input.history||[]),
  engine:'whole-roster-due-optional-v12',optimal:false,attempts,elapsedMs:Date.now()-started,
  message:status==='complete'?'전체 근무표 간격 최적화 완료 (최적해 보장 없음)':'부분 편성: 필수 근무를 완성하지 못했습니다. 실제 근무에 사용 금지'};
}
function repairUnassigned(initial,people,blocked,available,score,deadline){
 const roster=initial.map(a=>({...a}));
 for(let pass=0;pass<people.length&&Date.now()<deadline;pass++){
  const absent=people.filter(p=>!roster.some(a=>a.personId===p.id)&&blocked.get(p.id).filter(x=>!x).length>=8);
  if(!absent.length)break;
  let changed=false;
  for(const p of absent){
   let bestIndex=-1,bestValue=Infinity;
   for(let i=0;i<roster.length;i++){
    const a=roster[i];
    if(a.locked||!available(p,a,roster,i))continue;
    const previous=a.personId;
    a.personId=p.id;
    const value=score(roster);
    a.personId=previous;
    if(value<bestValue){bestValue=value;bestIndex=i;}
   }
   if(bestIndex>=0){roster[bestIndex].personId=p.id;changed=true;}
  }
  if(!changed)break;
 }
 return roster;
}
function optimize(roster,people,available,score,deadline){
 let best=score(roster);
 for(let pass=0;pass<12&&Date.now()<deadline;pass++){
  let changed=false;
  for(let i=0;i<roster.length&&Date.now()<deadline;i++){
   if(roster[i].locked)continue;
   const a=roster[i],original=a.personId;
   for(const p of people){
    if(p.id===original||!available(p,a,roster,i))continue;
    a.personId=p.id;const value=score(roster);
    if(value<best-0.001){best=value;changed=true;break;}
    a.personId=original;
   }
  }
  // Exchange two slots, including cross-role exchanges, if both remain eligible.
  for(let i=0;i<roster.length&&Date.now()<deadline;i++){
   if(roster[i].locked)continue;
   for(let j=i+1;j<roster.length&&Date.now()<deadline;j++){
    if(roster[j].locked||roster[i].personId===roster[j].personId)continue;
    const a=roster[i],b=roster[j],aid=a.personId,bid=b.personId;
    if(!available(people.find(p=>p.id===bid),a,roster,i,j)||!available(people.find(p=>p.id===aid),b,roster,i,j))continue;
    a.personId=bid;b.personId=aid;
    const value=score(roster);
    if(value<best-0.001){best=value;changed=true;break;}
    a.personId=aid;b.personId=bid;
   }
   if(changed)break;
  }
  if(!changed)break;
 }
 return roster;
}
function fillOptionalSlots(initial,people,blocked,history,mondayISO,restrictions,deadline){
 // Radio is a flexible bridging duty: 3+3 and repeated optional duties are allowed.
 // Never violate role, leave, OUT or the global minimum 3-shift gap.
 const roster=initial.map(a=>({...a}));
 const seq=a=>a.day*5+a.shift;
 const key=a=>a.day+'/'+a.shift+'/'+a.role;
 const occupied=new Set(roster.map(key));
 const byPerson=new Map(people.map(p=>[p.id,roster.filter(a=>a.personId===p.id).map(seq)]));
 const gapCost=g=>g<=4?0:g===5?15:g===6?500:g===7?700:900+(g-8)*130;
 // Proactively give a due person an optional duty when a required slot went to
 // someone else. This also covers the last duty in the 8-day horizon.
 // Existing required duties are never moved, and future duties must stay >=3 apart.
 const dueCandidates=[];
 for(const p of people){
  const all=[...byPerson.get(p.id),...(history.get(p.id)||[])].sort((a,b)=>a-b);
  for(let q=0;q<40;q++){
   const before=all.filter(x=>x<q).at(-1),after=all.find(x=>x>q);
   if(before===undefined||q-before!==4||after!==undefined&&after-q<3)continue;
   if(after!==undefined&&after-before<=6)continue;
   if(blocked.get(p.id)[q]||!allowedBeforeLeave(mondayISO,restrictions,p.id,Math.floor(q/5),q%5))continue;
   for(const role of (p.baseRole==='driver'?['radio','reserveDriver']:['radio'])){
    const slot={day:Math.floor(q/5),shift:q%5,role};
    if(!occupied.has(key(slot)))dueCandidates.push({p,slot,q,next:after??Infinity});
   }
  }
 }
 dueCandidates.sort((a,b)=>(b.next-b.q)-(a.next-a.q)||a.q-b.q);
 for(const {p,slot,q} of dueCandidates){
  if(Date.now()>=deadline)break;
  if(occupied.has(key(slot)))continue;
  const all=[...byPerson.get(p.id),...(history.get(p.id)||[])];
  if(all.some(x=>Math.abs(x-q)<3))continue;
  const prev=all.filter(x=>x<q).sort((a,b)=>b-a)[0];
  const next=all.filter(x=>x>q).sort((a,b)=>a-b)[0];
  if(prev===undefined||q-prev!==4||next!==undefined&&next-q<3)continue;
  const a={...slot,personId:p.id};
  roster.push(a);occupied.add(key(a));byPerson.get(p.id).push(q);
 }
 const evaluate=(p,slot)=>{
  const q=seq(slot);
  if(!eligible(p,slot.role)||blocked.get(p.id)[q]||
     !allowedBeforeLeave(mondayISO,restrictions,p.id,slot.day,slot.shift))return Infinity;
  const duties=byPerson.get(p.id);
  const all=[...duties,...(history.get(p.id)||[])].sort((a,b)=>a-b);
  if(all.some(x=>Math.abs(x-q)<3))return Infinity;
  const before=all.filter(x=>x<q).at(-1),after=all.find(x=>x>q);
  if(before===undefined||after===undefined)return Infinity;
  const left=q-before,right=after-q;
  if(left<3||right<3)return Infinity;
  const gap=after-before;
  // Do not add optional duties to a 5-shift interval: it cannot be split safely.
  if(gap<6)return Infinity;
  let gain=gapCost(gap)-gapCost(left)-gapCost(right);
  // Strongly prefer radio for bridging, even when it creates consecutive 3-gaps.
  if(slot.role==='radio')gain+=40;
  else gain+=5;
  // Do not overschedule an already heavily assigned person unless a long gap is repaired.
  const weekly=duties.filter(x=>x<35).length;
  if(slot.day<7&&weekly>=10)gain-=150;
  if(slot.day<7&&weekly>=9)gain-=50;
  return gain>0?-gain:Infinity;
 };
 for(let iteration=0;iteration<80&&Date.now()<deadline;iteration++){
  let best=null,bestScore=Infinity;
  for(let day=0;day<8&&Date.now()<deadline;day++)
   for(let shift=0;shift<5;shift++)
    for(const role of ['radio','reserveDriver']){
     const slot={day,shift,role};
     if(occupied.has(key(slot)))continue;
     for(const p of people){
      const value=evaluate(p,slot);
      if(value<bestScore){bestScore=value;best={p,slot};}
     }
    }
  if(!best)break;
  const a={...best.slot,personId:best.p.id};
  roster.push(a);occupied.add(key(a));byPerson.get(best.p.id).push(seq(a));
 }
 return roster;
}
