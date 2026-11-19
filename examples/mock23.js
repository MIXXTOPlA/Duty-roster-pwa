// Entirely fictional identifiers; no real personnel information.
export const mockPeople = [
 ...Array.from({length:6},(_,i)=>({id:`L${i+1}`,name:`가상분대장${i+1}`,baseRole:'leader',intake:870+i})),
 ...Array.from({length:6},(_,i)=>({id:`D${i+1}`,name:`가상조종수${i+1}`,baseRole:'driver',intake:870+i})),
 ...Array.from({length:11},(_,i)=>({id:`R${i+1}`,name:`가상소총수${i+1}`,baseRole:'rifle',intake:870+i}))
];
export const mockInput = {mondayISO:'2026-11-23',people:mockPeople,assignments:[],restrictions:[],history:[]};