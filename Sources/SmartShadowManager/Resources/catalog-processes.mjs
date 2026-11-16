import {execFileSync} from 'node:child_process';

const rows = text => text.trim().split('\n').map(line => {
 const m=line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
 return m&&{pid:+m[1],ppid:+m[2],uid:+m[3],path:m[4]};
}).filter(Boolean);

// A whole-machine ps census can block on unrelated processes on macOS. Start
// from the registered host and inspect only exact child candidates; retain the
// same UID, parent, executable, argv and uniqueness checks as the original reader.
export function catalogBackend({hostPID,uid,hostPath,binary,run=execFileSync}) {
 if(!Number.isSafeInteger(hostPID)||hostPID<=0)throw Error('host identity changed');
 const options={encoding:'utf8'};
 const host=rows(run('/bin/ps',['-p',String(hostPID),'-o','pid=,ppid=,uid=,comm='],options));
 if(!host.some(r=>r.pid===hostPID&&r.uid===uid&&r.path===hostPath))throw Error('host identity changed');
 const pattern='^'+binary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'( |$)';
 let found;
 try {
  // Darwin pgrep excludes ancestors by default. The reader may itself be run
  // from this backend, so -a is necessary to include that exact direct child.
  found=run('/usr/bin/pgrep',['-a','-P',String(hostPID),'-f',pattern],options);
 }catch(error){if(error.status!==1)throw error;found='';}
 const candidates=found.trim().split(/\s+/).filter(Boolean);
 if(!candidates.length||candidates.some(p=>!/^\d+$/.test(p)||!Number.isSafeInteger(+p)||+p<=0))throw Error('backend identity changed');
 const selection=[...new Set(candidates)].join(',');
 const children=rows(run('/bin/ps',['-p',selection,'-o','pid=,ppid=,uid=,comm='],options));
 const commands=run('/bin/ps',['-p',selection,'-o','pid=,command='],options).split('\n');
 const backends=children.filter(r=>r.ppid===hostPID&&r.uid===uid&&r.path===binary&&commands.some(s=>new RegExp('^\\s*'+r.pid+'\\s+').test(s)&&/\sapp-server(?:\s|$)/.test(s)));
 if(backends.length!==1)throw Error('backend identity changed');
 return backends[0];
}
