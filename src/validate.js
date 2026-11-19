import {SHIFTS,ROLES,REQUIRED_ROLES,MIN_GAP,slotIndex,shiftInterval,eligible,allowedBeforeLeave} from './model.js?v=201';
// assignments: [{day:0..7, shift:0..4, role:'leader'..., personId:'...'}]
// restrictions: [{personId, start:'YYYY-MM-DDTHH:mm', end:'YYYY-MM-DDTHH:mm'}]
// locked assignments use the same shape with locked:true.
export function validateRoster({mondayISO,people,assignments,restrictions=[],history=[]}){
 const errors=[];const peopleById=new Map(people.map(p=>[p.id,p]));
 const seenSlots=new Set(); const dutiesByPerson=new Map();
 const add=(code,detail)=>errors.push({code,...detail});
 for(const a of assignments){
  const key=`${a.day}/${a.shift}/${a.role}`;
  if(!Number.isInteger(a.day)||a.day<0||a.day>7||!Number.isInteger(a.shift)||a.shift<0||a.shift>4||!ROLES.includes(a.role)){add('INVALID_SLOT',{assignment:a});continue;}
  if(seenSlots.has(key))add('DUPLICATE_SLOT',{assignment:a});seenSlots.add(key);
  const p=peopleById.get(a.personId);
  if(!p){add('UNKNOWN_PERSON',{assignment:a});continue;}
  if(!eligible(p,a.role))add('INELIGIBLE_ROLE',{assignment:a});
  if(!allowedBeforeLeave(mondayISO,restrictions,a.personId,a.day,a.shift))add('INVALID_PRE_LEAVE_SHIFT',{assignment:a});
  const iso=new Date(Date.parse(mondayISO+'T00:00:00Z')+a.day*86400000).toISOString().slice(0,10);
  const interval=shiftInterval(iso,SHIFTS[a.shift].id);
  for(const r of restrictions.filter(r=>r.personId===a.personId)){
   const start=Date.parse(r.start+'Z'),end=Date.parse(r.end+'Z');
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){add('INVALID_RESTRICTION',{restriction:r});continue;}
   if(interval.start<end&&start<interval.end)add('RESTRICTION_OVERLAP',{assignment:a,restriction:r});
  }
  const seq=slotIndex(a.day,a.shift);
  if(!dutiesByPerson.has(a.personId))dutiesByPerson.set(a.personId,[]);
  dutiesByPerson.get(a.personId).push({seq,assignment:a});
 }
 for(const [personId,duties] of dutiesByPerson){
  const previous=history.filter(h=>h.personId===personId).map(h=>({seq:h.seq,assignment:h}));
  const ordered=[...previous,...duties].sort((a,b)=>a.seq-b.seq);
  for(let i=1;i<ordered.length;i++){
   if(ordered[i].seq===ordered[i-1].seq)add('DOUBLE_BOOKED',{personId,assignments:[ordered[i-1].assignment,ordered[i].assignment]});
   else if(ordered[i].seq-ordered[i-1].seq<MIN_GAP)add('GAP_TOO_SHORT',{personId,assignments:[ordered[i-1].assignment,ordered[i].assignment]});
  }
 }
 const missing=[];
 for(let day=0;day<8;day++)for(let shift=0;shift<5;shift++)for(const role of REQUIRED_ROLES){
  if(!seenSlots.has(`${day}/${shift}/${role}`))missing.push({day,shift,role});
 }
 return {valid:errors.length===0&&missing.length===0,errors,missingRequired:missing,partialValid:errors.length===0};
}