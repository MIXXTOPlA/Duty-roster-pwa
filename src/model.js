export const SHIFTS = [
  {id:'morning',label:'오전',start:'07:45',end:'12:15',durationMinutes:270},
  {id:'afternoon',label:'오후',start:'12:15',end:'17:15',durationMinutes:300},
  {id:'evening',label:'석간',start:'17:15',end:'21:45',durationMinutes:270},
  {id:'thirteen',label:'열셋',start:'21:45',end:'02:45',durationMinutes:300},
  {id:'last',label:'말번',start:'02:45',end:'07:45',durationMinutes:300}
];
export const ROLES = ['leader','driver','m60','rifle','radio','reserveDriver'];
export const REQUIRED_ROLES = ROLES.slice(0,4);
export const OPTIONAL_ROLES = ROLES.slice(4);
export const SLOTS_PER_DAY = SHIFTS.length * ROLES.length;
export const WEEK_DAYS = 8;
export const MIN_GAP = 3;
export function slotIndex(day,shiftIndex){return day*SHIFTS.length+shiftIndex;}
export function shiftInterval(dateISO, shiftId){
 const s=SHIFTS.find(x=>x.id===shiftId); if(!s)throw Error('Unknown shift');
 const date=new Date(dateISO+'T00:00:00Z');
 const [h,m]=s.start.split(':').map(Number);
 if(shiftId==='last') date.setUTCDate(date.getUTCDate()+1);
 date.setUTCHours(h,m,0,0);
 return {start:date.getTime(),end:date.getTime()+s.durationMinutes*60000};
}
export function eligible(person,role){
 if(role==='radio')return true;
 if(role==='leader')return person.baseRole==='leader';
 if(role==='driver'||role==='reserveDriver')return person.baseRole==='driver';
 if(role==='m60'||role==='rifle')return ['rifle','driver','leader'].includes(person.baseRole);
 return false;
}
export function countMinutes(assignments){return assignments.reduce((total,a)=>total+SHIFTS[a.shift].durationMinutes,0);}
export function leaveOutRule(mondayISO,restrictions=[],personId){
 const base=Date.parse(mondayISO+'T00:00:00Z');
 return restrictions.filter(r=>r.personId===personId&&r.type==='leave'&&r.start).map(r=>{
  const start=Date.parse(r.start+'Z');
  if(!Number.isFinite(start))return null;
  const outDay=Math.floor((Date.parse(r.start.slice(0,10)+'T00:00:00Z')-base)/86400000)-1;
  return {outDay,start};
 }).filter(Boolean);
}
export function allowedBeforeLeave(mondayISO,restrictions,personId,day,shift){
 // OUT must be the last duty before leave, on the previous calendar day,
 // in morning/afternoon/evening only. Do not allow earlier assignments to be mislabeled.
 const q=day*5+shift;
 for(const rule of leaveOutRule(mondayISO,restrictions,personId)){
  if(rule.outDay<0||rule.outDay>7)continue;
  if(q>rule.outDay*5+2&&q<Math.ceil((rule.start-Date.parse(mondayISO+'T00:00:00Z'))/86400000)*5)return false;
 }
 return true;
}
