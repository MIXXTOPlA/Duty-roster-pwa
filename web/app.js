import {mockPeople} from '../examples/mock23.js';
import {SHIFTS,ROLES,REQUIRED_ROLES} from '../src/model.js';
import {validateRoster} from '../src/validate.js';
import {analyzeFairness} from '../src/metrics.js';
const $=id=>document.getElementById(id),roleNames={leader:'분대장',driver:'조종수',m60:'M60',rifle:'소총수',radio:'통신병',reserveDriver:'예비 조종수'};
const monday=$('monday'),status=$('status'),metrics=$('metrics'),save=$('save');
const today=new Date(),weekday=(today.getDay()+6)%7;today.setDate(today.getDate()-weekday);monday.value=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');
let working=null,versions=[],people=structuredClone(mockPeople),restrictions=[];
function gapLabels(assignments,history=[]){const groups=new Map(),labels=new Map();for(const a of assignments){if(!groups.has(a.personId))groups.set(a.personId,[]);groups.get(a.personId).push(a);}for(const [id,items] of groups){items.sort((a,b)=>(a.day*5+a.shift)-(b.day*5+b.shift));let prev=history.filter(h=>h.personId===id&&Number.isInteger(h.seq)).reduce((max,h)=>Math.max(max,h.seq),-Infinity);for(const a of items){const seq=a.day*5+a.shift;const gap=seq-prev;if(Number.isFinite(prev)&&gap!==4)labels.set(`${a.day}/${a.shift}/${a.role}`,String(gap));prev=seq;}}return labels;}
function outAssignments(assignments,restrictions=[],mondayISO){const out=new Set();if(!mondayISO)return out;const base=Date.parse(mondayISO+'T00:00:00Z');for(const r of restrictions){if(r.type!=='leave'||!r.start||!r.personId)continue;const leaveStart=Date.parse(r.start+'Z');if(!Number.isFinite(leaveStart))continue;let last=null,lastEnd=-Infinity;for(const a of assignments){if(a.personId!==r.personId)continue;const date=new Date(base+a.day*86400000).toISOString().slice(0,10);const iv=SHIFTS[a.shift];const start=Date.parse(date+'T'+iv.start+':00Z')+(a.shift===4?86400000:0);const end=start+iv.durationMinutes*60000;if(end<=leaveStart&&end>lastEnd){last=a;lastEnd=end;}}if(last)out.add(`${last.day}/${last.shift}/${last.role}`);}return out;}
function dbOpen(){return new Promise((resolve,reject)=>{const request=indexedDB.open('roster-demo-v09',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function readState(){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('state');const request=tx.objectStore('state').get('current');request.onsuccess=()=>{db.close();resolve(request.result)};request.onerror=()=>{db.close();reject(request.error)};});}
async function writeState(){const db=await dbOpen();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({working,versions,people,restrictions},'current');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)};});}
function mondayValid(value){const d=new Date(value+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.getUTCDay()===1;}
function dateAt(day){const d=new Date(monday.value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+day);return `${d.getUTCMonth()+1}/${d.getUTCDate()}`;}
function render(){const head=$('roster').tHead,body=$('roster').tBodies[0];head.replaceChildren();body.replaceChildren();const hr=head.insertRow();for(const title of ['날짜','근무',...ROLES.map(role=>roleNames[role])]){const th=document.createElement('th');th.textContent=title;hr.append(th);}
 const assignments=working?.assignments||[],gapBySlot=gapLabels(assignments,working?.history||[]),outs=outAssignments(assignments,working?.restrictions||[],working?.mondayISO);const bySlot=new Map(assignments.map(a=>[`${a.day}/${a.shift}/${a.role}`,a]));const byId=new Map(people.map(p=>[p.id,p]));
 for(let day=0;day<8;day++)for(let shift=0;shift<5;shift++){const tr=body.insertRow();if(shift===0)tr.className='day-start';const date=tr.insertCell();date.className='date-cell';if(shift===0){date.textContent=`${dateAt(day)} (${['월','화','수','목','금','토','일','월'][day]})`;date.rowSpan=5;}else{date.remove();}const label=tr.insertCell();label.className='shift-cell';label.textContent=SHIFTS[shift].label;
 for(const role of ROLES){const td=tr.insertCell(),a=bySlot.get(`${day}/${shift}/${role}`);const key=`${day}/${shift}/${role}`;td.textContent=a?`${byId.get(a.personId)?.name||a.personId}${gapBySlot.has(key)?' '+gapBySlot.get(key):''}${outs.has(key)?' OUT':''}`:REQUIRED_ROLES.includes(role)?'미배정':'+';if(!a)td.className=REQUIRED_ROLES.includes(role)?'empty':'optional-empty';}}
 if(working){const v=validateRoster({mondayISO:working.mondayISO,people,assignments:working.assignments,restrictions:working.restrictions||[],history:working.history||[]});metrics.replaceChildren();for(const text of [`필수 미배정 ${v.missingRequired.length}개`,`하드 오류 ${v.errors.length}건`,`총 배정 ${working.assignments.length}건`,`엔진 ${working.engine}`]){const span=document.createElement('span');span.textContent=text;metrics.append(span);}save.disabled=!v.valid;}else{metrics.replaceChildren();save.disabled=true;}
 renderStats();
 renderPeople();renderRestrictions();
 const list=$('versions');list.replaceChildren();if(!versions.length)list.textContent='저장된 버전이 없습니다.';for(const [i,v] of versions.entries()){const row=document.createElement('div');row.className='version-row';const title=document.createElement('span');title.textContent=`V${i+1} · ${v.mondayISO} · ${new Date(v.savedAt).toLocaleString('ko-KR')}`;const btn=document.createElement('button');btn.textContent='현재 작업본으로 복원';btn.onclick=async()=>{working=structuredClone(v.snapshot);monday.value=working.mondayISO;await writeState();render();status.textContent=`V${i+1}을 현재 작업본으로 복원했어요. 기존 버전은 유지됩니다.`};row.append(title,btn);list.append(row);}}
function renderStats(){const container=$('stats'),summary=$('stats-summary'),body=$('stats-body');if(!container||!summary||!body)return;body.replaceChildren();summary.replaceChildren();container.hidden=!working;if(!working)return;
 const assignments=working.assignments||[],fairness=analyzeFairness(assignments,people,[]);
 const optionalCount=assignments.filter(a=>a.role==='radio'||a.role==='reserveDriver').length;const gaps=[];for(const person of people){const seqs=assignments.filter(a=>a.personId===person.id).map(a=>a.day*5+a.shift).sort((a,b)=>a-b);for(let i=1;i<seqs.length;i++)gaps.push(seqs[i]-seqs[i-1]);}const values=fairness.perPerson.map(p=>p.weekCount),below=values.filter(v=>v<8).length,above=values.filter(v=>v>9).length;
 for(const label of [`선택 보직 ${optionalCount}건 (통신 ${assignments.filter(a=>a.role==='radio').length} · 예비조종 ${assignments.filter(a=>a.role==='reserveDriver').length})`,`4조 간격 ${gaps.filter(g=>g===4).length}건`,`3조 간격 ${gaps.filter(g=>g===3).length}건`,`7조 이상 ${gaps.filter(g=>g>=7).length}건`,`월~일 8~9회 미달 ${below}명`,`9회 초과 ${above}명`,`주간 횟수 편차 ${fairness.weeklyCountSpread}회`,`야간 횟수 편차 ${fairness.nightSpread}회`]){const span=document.createElement('span');span.textContent=label;summary.append(span);}
 const byId=new Map(people.map(p=>[p.id,p]));const roleNamesShort={leader:'분대장',driver:'조종수',rifle:'소총수'};
 for(const p of fairness.perPerson){const person=byId.get(p.personId),weekly=assignments.filter(a=>a.personId===p.personId&&a.day<7),all=assignments.filter(a=>a.personId===p.personId);const tr=body.insertRow();const values=[person?.name||p.personId,roleNamesShort[person?.baseRole]||'-',String(p.weekCount),String(all.length),...Array.from({length:5},(_,shift)=>String(weekly.filter(a=>a.shift===shift).length)),String(p.nightCount),(all.reduce((sum,a)=>sum+SHIFTS[a.shift].durationMinutes,0)/60).toFixed(1),String(p.threeGaps)];for(let i=0;i<values.length;i++){const td=tr.insertCell();td.textContent=values[i];if(i===2&&(p.weekCount<8||p.weekCount>9))td.className='stat-warning';}}
}
$('generate').onclick=async()=>{if(!mondayValid(monday.value)){status.textContent='월요일 날짜를 선택하세요.';return;}const button=$('generate');button.disabled=true;const start=performance.now();status.textContent='편성 엔진 불러오는 중…';try{const {generateRoster}=await import('../src/solver.js?v=120');status.textContent='자동 편성 계산 중…';const input={mondayISO:monday.value,people,assignments:[],restrictions:structuredClone(restrictions),history:[]};const result=await generateRoster(input,{limitMs:60000});working={mondayISO:monday.value,assignments:result.assignments||[],restrictions:input.restrictions,history:input.history,engine:result.engine||'unknown'};try{await writeState();}catch(error){status.textContent='로컬 저장 실패: '+String(error);}render();status.textContent=`${result.status==='complete'?'필수 근무 편성 완료':'부분 편성 (실제 근무 사용 금지)'} · ${Math.round(performance.now()-start)}ms · 필수 미배정 ${result.validation?.missingRequired?.length??'알 수 없음'}개 · 하드 오류 ${result.validation?.errors?.length??'알 수 없음'}건`;}catch(error){status.textContent='자동 편성 실행 오류: '+(error?.stack||String(error));}finally{button.disabled=false;}};
save.onclick=async()=>{if(!working)return;versions.push({mondayISO:working.mondayISO,savedAt:new Date().toISOString(),snapshot:structuredClone(working)});await writeState();render();status.textContent=`V${versions.length} 저장 완료`};
$('restore').onclick=async()=>{try{const state=await readState();if(!state){status.textContent='저장된 작업본이 없습니다.';return;}working=state.working;versions=state.versions||[];people=Array.isArray(state.people)?state.people:structuredClone(mockPeople);restrictions=Array.isArray(state.restrictions)?state.restrictions:[];if(working)monday.value=working.mondayISO;render();status.textContent='기기에 저장된 작업본을 불러왔습니다.';}catch(e){status.textContent='불러오기 실패: '+e}};
try{const state=await readState();if(state){working=state.working;versions=state.versions||[];people=Array.isArray(state.people)?state.people:structuredClone(mockPeople);restrictions=Array.isArray(state.restrictions)?state.restrictions:[];if(working)monday.value=working.mondayISO;status.textContent='v0.12.0 실행 중 · 이전 작업본 자동 복원';}}catch(e){status.textContent='로컬 저장소를 사용할 수 없습니다: '+e;}render();
if(!working)status.textContent='v0.12.0 실행 중 · 자동 편성을 눌러 테스트하세요.';
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
function renderPeople(){
 const body=$('people-body'),summary=$('people-summary');if(!body)return;
 body.replaceChildren();const counts={leader:0,driver:0,rifle:0};
 for(const p of people)counts[p.baseRole]=(counts[p.baseRole]||0)+1;
 summary.textContent=`총 ${people.length}명 · 분대장 ${counts.leader} · 조종수 ${counts.driver} · 소총수 ${counts.rifle}`;
 for(const p of people){
  const tr=body.insertRow();
  for(const value of [p.name,roleNames[p.baseRole]||p.baseRole,String(p.intake??'-')]){const td=tr.insertCell();td.textContent=value;}
  const td=tr.insertCell(),edit=document.createElement('button'),del=document.createElement('button');
  edit.textContent='수정';edit.className='secondary';edit.onclick=()=>fillPersonForm(p.id);
  del.textContent='삭제';del.className='secondary';del.onclick=async()=>{
   if(restrictions.some(r=>r.personId===p.id)||(working?.assignments||[]).some(a=>a.personId===p.id)||versions.some(v=>(v.snapshot?.assignments||[]).some(a=>a.personId===p.id))){
    $('person-status').textContent='현재 근무표 또는 저장 버전에서 사용 중인 인원은 삭제할 수 없습니다.';return;
   }
   if(!confirm(`${p.name} 인원을 삭제할까요?`))return;
   people=people.filter(x=>x.id!==p.id);await writeState();render();$('person-status').textContent='삭제 완료';
  };
  td.append(edit,del);
 }
}
function fillPersonForm(id){
 const p=people.find(x=>x.id===id);$('person-id').value=p?.id||'';
 $('person-name').value=p?.name||'';$('person-role').value=p?.baseRole||'rifle';
 $('person-intake').value=p?.intake??'';$('person-submit').textContent=p?'변경 저장':'인원 추가';
 $('person-name').focus();
}
$('person-reset').onclick=()=>fillPersonForm(null);
$('person-form').onsubmit=async e=>{
 e.preventDefault();
 const id=$('person-id').value,name=$('person-name').value.trim(),baseRole=$('person-role').value,intake=Number($('person-intake').value);
 if(!name||name.length>30||!['leader','driver','rifle'].includes(baseRole)||!Number.isInteger(intake)||intake<1||intake>9999){$('person-status').textContent='이름(30자 이내), 보직, 기수(1~9999)를 확인하세요.';return;}
 if(people.some(p=>p.name===name&&p.id!==id)){$('person-status').textContent='동일한 이름이 이미 있습니다.';return;}
 if(id){
  const p=people.find(x=>x.id===id);if(!p)return;
  if(p.baseRole!==baseRole&&((working?.assignments||[]).some(a=>a.personId===id)||versions.some(v=>(v.snapshot?.assignments||[]).some(a=>a.personId===id)))){
   $('person-status').textContent='근무표에 사용된 인원의 보직은 변경할 수 없습니다. 이름과 기수만 수정할 수 있습니다.';return;
  }
  Object.assign(p,{name,baseRole,intake});
 }else{
  const newId='P'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2));
  people.push({id:newId,name,baseRole,intake});
 }
 await writeState();fillPersonForm(null);render();$('person-status').textContent='기기에 저장했습니다.';
};

function renderRestrictions(){
 const select=$('absence-person'),body=$('absence-body'),summary=$('absence-summary');
 if(!select||!body)return;
 const selected=select.value;select.replaceChildren();
 for(const p of people){const opt=document.createElement('option');opt.value=p.id;opt.textContent=p.name+' · '+(roleNames[p.baseRole]||p.baseRole);select.append(opt);}
 if(people.some(p=>p.id===selected))select.value=selected;
 body.replaceChildren();
 const sorted=[...restrictions].sort((a,b)=>a.start.localeCompare(b.start));
 summary.textContent='등록된 일정 '+sorted.length+'건 · 자동 편성 시 해당 시간대 배정 제외';
 for(const r of sorted){
  const tr=body.insertRow(),p=people.find(x=>x.id===r.personId);
  for(const value of [p?.name||r.personId,r.type==='leave'?'휴가':'외출',r.start.replace('T',' '),r.end.replace('T',' ')]){const td=tr.insertCell();td.textContent=value;}
  const td=tr.insertCell(),btn=document.createElement('button');btn.className='secondary';btn.textContent='삭제';
  btn.onclick=async()=>{if(!confirm('이 일정을 삭제할까요?'))return;restrictions=restrictions.filter(x=>x.id!==r.id);await writeState();render();$('absence-status').textContent='일정을 삭제했습니다. 근무표에 반영하려면 다시 자동 편성하세요.';};
  td.append(btn);
 }
}
$('absence-form').onsubmit=async e=>{
 e.preventDefault();
 const personId=$('absence-person').value,type=$('absence-type').value,start=$('absence-start').value,end=$('absence-end').value;
 const startMs=Date.parse(start),endMs=Date.parse(end);
 if(!people.some(p=>p.id===personId)||!['leave','outing'].includes(type)||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs){
  $('absence-status').textContent='인원과 시작·종료 시간을 확인하세요. 종료는 시작보다 늦어야 합니다.';return;
 }
 if(restrictions.some(r=>r.personId===personId&&Date.parse(r.start)<endMs&&startMs<Date.parse(r.end))){
  $('absence-status').textContent='같은 인원의 기존 일정과 겹칩니다.';return;
 }
 restrictions.push({id:'A'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)),personId,type,start,end});
 await writeState();render();$('absence-status').textContent='일정 저장 완료. 새로 자동 편성하면 반영됩니다.';
};
