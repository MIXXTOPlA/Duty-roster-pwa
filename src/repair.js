import {eligible,REQUIRED_ROLES} from './model.js';
import {validateRoster} from './validate.js';
export function repairPartial(input, initial, {deadline=Date.now()+1500,maxNodes=20000}={}) {
 const slots=[];for(let day=0;day<8;day++)for(let shift=0;shift<5;shift++)for(const role of REQUIRED_ROLES)slots.push({day,shift,role});
 const key=a=>`${a.day}/${a.shift}/${a.role}`;
 const roster=new Map(initial.map(a=>[key(a),{...a}]));
 const people=input.people;
 const baseHistory=new Map(people.map(p=>[p.id,(input.history||[]).filter(h=>h.personId===p.id).map(h=>h.seq)]));
 const restrictions=input.restrictions||[];
 const isoDay=d=>new Date(Date.parse(input.mondayISO+'T00:00:00Z')+d*86400000).toISOString().slice(0,10);
 const startMs=(day,shift)=>Date.parse(isoDay(day)+'T00:00:00Z')+[465,735,1035,1305,1605][shift]*60000;
 const durations=[270,300,270,300,300];
 const allowed=(p,s)=>{if(!eligible(p,s.role))return false;const start=startMs(s.day,s.shift),end=start+durations[s.shift]*60000;return !restrictions.some(r=>r.personId===p.id&&start<Date.parse(r.end+'Z')&&Date.parse(r.start+'Z')<end);};
 const seq=a=>a.day*5+a.shift;
 let nodes=0,best=[...roster.values()];
 const counts=new Map(people.map(p=>[p.id,initial.filter(a=>a.personId===p.id&&a.day<7).length]));
 const visited=new Set();
 function search(depth){
  if(++nodes>maxNodes||Date.now()>=deadline)return false;
  if(roster.size>best.length)best=[...roster.values()].map(a=>({...a}));
  const missing=slots.filter(s=>!roster.has(key(s)));if(!missing.length)return true;if(depth<=0)return false;
  let chosen=null,options=null;
  for(const s of missing){const choices=people.filter(p=>allowed(p,s));if(!options||choices.length<options.length){chosen=s;options=choices;}}
  options.sort((a,b)=>counts.get(a.id)-counts.get(b.id)||a.id.localeCompare(b.id));
  for(const p of options){
   const conflicts=[...roster.values()].filter(a=>a.personId===p.id&&Math.abs(seq(a)-seq(chosen))<3);
   if(conflicts.some(a=>a.locked))continue;
   if(baseHistory.get(p.id).some(s=>Math.abs(s-seq(chosen))<3))continue;
   if(conflicts.length>2)continue;
   const signature=`${key(chosen)}:${p.id}:${conflicts.map(key).sort().join(',')}:${depth}`;
   if(visited.has(signature))continue;visited.add(signature);
   for(const c of conflicts){roster.delete(key(c));if(c.day<7)counts.set(p.id,counts.get(p.id)-1);}
   const newA={...chosen,personId:p.id};roster.set(key(chosen),newA);
   if(chosen.day<7)counts.set(p.id,counts.get(p.id)+1);
   if(search(depth-1))return true;
   roster.delete(key(chosen));if(chosen.day<7)counts.set(p.id,counts.get(p.id)-1);
   for(const c of conflicts){roster.set(key(c),c);if(c.day<7)counts.set(p.id,counts.get(p.id)+1);}
  }return false;
 }
 const complete=search(14);const result=complete?[...roster.values()]:best;
 const validation=validateRoster({...input,assignments:result});
 return {assignments:result,complete:validation.valid,nodes,validation,exhausted:Date.now()>=deadline||nodes>maxNodes};
}