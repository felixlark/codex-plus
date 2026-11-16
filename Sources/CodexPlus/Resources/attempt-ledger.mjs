import path from 'node:path';

// Read the legacy journal without changing it. Its unknown keys continue to
// suppress retransmission after the two products stop sharing runtime files.
export async function loadAttemptLedger(io,file,legacy){
  const decode=value=>{const v=JSON.parse(value);if(!Array.isArray(v)||v.some(k=>typeof k!=='string'))throw Error('Invalid attempt journal');return v;};
  let own=[];
  try{own=decode(await io.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const imported=decode(await io.readFile(legacy,'utf8'));
  const result=[...new Set([...own,...imported])];
  await io.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  await io.writeFile(file+'.tmp',JSON.stringify(result),{mode:0o600});await io.rename(file+'.tmp',file);
  return result;
}
