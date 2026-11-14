// Only a successfully queried list of live main-window targets reaches this
// allocator. Keep a window's number across ordering changes and Plus restarts.
export function allocateWindowNumbers(targetIds,saved={}) {
  const targets=[...new Set(targetIds)],assigned=new Map(),used=new Set();
  if(!saved||typeof saved!=='object'||Array.isArray(saved))saved={};
  for(const target of targets){
    const number=Object.hasOwn(saved,target)?saved[target]:undefined;
    if(Number.isSafeInteger(number)&&number>0&&!used.has(number)){assigned.set(target,number);used.add(number);}
  }
  for(const target of targets)if(!assigned.has(target)){
    let number=1;while(used.has(number))number++;
    assigned.set(target,number);used.add(number);
  }
  return Object.fromEntries(assigned);
}
