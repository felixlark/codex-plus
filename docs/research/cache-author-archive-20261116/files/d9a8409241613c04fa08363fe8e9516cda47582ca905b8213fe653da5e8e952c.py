if not __debug__: raise RuntimeError('metadata_driver_requires_assertions')
import os,sys,json,hashlib,subprocess,types,stat,datetime,xml.etree.ElementTree as ET
from pathlib import Path
HOME=Path.home();G=HOME/'Projects/smart-shadow';E=HOME/'Library/Caches/me.longbiaochen.smart-shadow/pn-native-final-20261102';A=HOME/'Library/Logs/me.longbiaochen.smart-shadow/pn-native-final-20261102/a-ordinary-deb96-4a5ed8b1'
D=Path(__file__).parent;SHA='bcb2e6a900baec70c9b9bbf67b490f4f206cf3f7';TASK='01a15a14-24dd-7363-9eba-2b2c72e2c930'
PREP=D/'PREPARED-BUILD.json';PREP_SHA='b6794efddbaf1e863c4eaa5d61f2dfc83fa34e24044f7f7f0322f4ee81d786df'
def digest(raw):return hashlib.sha256(raw).hexdigest()
def load(path,name,pin):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_uid==os.getuid() and before.st_nlink==1 and not stat.S_IMODE(before.st_mode)&0o022
  with os.fdopen(os.dup(fd),'rb')as stream:raw=stream.read()
  def stamp(s):return(s.st_dev,s.st_ino,s.st_mode,s.st_uid,s.st_gid,s.st_nlink,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
  assert stamp(before)==stamp(os.fstat(fd))==stamp(path.lstat()) and len(raw)==before.st_size and digest(raw)==pin
 finally:os.close(fd)
 module=types.ModuleType(name);module.__file__=str(path);module.__package__=None;sys.modules[name]=module
 exec(compile(raw,str(path),'exec',dont_inherit=True),module.__dict__);return module

def reference(path):return {'path':str(path),'sha256':digest(path.read_bytes())}
assert os.environ['CODEX_THREAD_ID']==TASK
assert digest(PREP.read_bytes())==PREP_SHA
prep=json.loads(PREP.read_bytes());LOG=Path(prep['log_directory'])
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=G,text=True).strip()==SHA
xml=E/'bcb2-pytest-exit-audit-v3/results.xml';tree=ET.parse(xml);suites=tree.getroot().findall('testsuite');assert sum(int(s.attrib['tests'])for s in suites)==1651 and all(s.attrib['errors']=='0' and s.attrib['failures']=='0'for s in suites)
events=[json.loads(s)for s in (E/'bcb2-pytest-exit-audit-v3/events.jsonl').read_text().splitlines()];assert any(x['kind']=='session_finished'and x['exitstatus']==0 for x in events)and any(x['kind']=='pytest_returned'and x['code']==0 for x in events)
ins=load(G/'dev-ops/scripts/ss-service-controller-install','actual_metadata_installer','530313a9c439cbcc08dcde738cc3815568d7680cdafedf3c515b7f939dae9d92')
main=load(G/'scripts/ss-deploy-main.py','formal_metadata_lock','2a59da9a186a8c4a162c3ff4385e5c183e07559df731fa3ef8438b33f434b119')
observer=load(E/'metadata-runtime-observer-v1/ss-metadata-current-observe-v2.py','independent_old_observer','774381b7f37bec0690d56eb57ea77006c459a4327e2cd9805b90471b7d33a743')
lock_bytes=None;lock_inode=None
context=ins.Context(HOME,G);holder='smart-shadow-deploy:'+TASK+':metadata-cow:'+prep['operation_id'];owned=False
review=HOME/'Library/Logs/me.longbiaochen.smart-shadow/REVIEW-BCB2-COW-METADATA-GIT-01a19500.json';assert digest(review.read_bytes())=='5dc489349d604a09be5e6955823619e71c5ceff3f9df9bc99a9dafe727645430'
def controls_projection(observation):
 value=observation['actual_api']['controls'];collectors=value['collectors'];sources=value['sources']
 assert len({r['collector_ref']for r in collectors})==len(collectors) and all(type(r['enabled'])is bool for r in collectors)
 assert len({r['source']for r in sources})==len(sources) and all(type(r['enabled'])is bool for r in sources)
 return {'collectors':sorted(({k:r[k]for k in ('collector_ref','source','enabled','revision')}for r in collectors),key=lambda r:r['collector_ref']),
         'sources':sorted(({k:r[k]for k in ('source','enabled','revision','collectors')}for r in sources),key=lambda r:r['source'])}
def save(name,value):
 path=LOG/name;ins.write_new(path,(json.dumps(value,ensure_ascii=False,indent=2)+chr(10)).encode());return path
try:
 assert not main.LOCK.exists() and not main.LOCK.is_symlink(),'formal lock currently occupied; coordinate original owner'
 inode,birth=main.acquire_lock(LOG,holder,'reviewed preservation-only metadata tool repair')
 lock_inode=inode;lock_bytes=(main.LOCK/'owner').read_bytes();assert lock_bytes.startswith((holder+' ').encode()) and ('pid='+str(os.getpid())).encode() in lock_bytes.split();owned=True
 targets=ins.targets(HOME,True);preimage={k:ins.target_snapshot(Path(v),k=='cow_policy')for k,v in targets['files'].items()}
 assert preimage['controller']['sha256']==prep['build_base']['sha256'] and preimage['module']['sha256']==prep['module']['sha256']
 core=context.core(ins.raw_of(preimage['controller']),Path(targets['logical_root'])/'bin/ss-service');ctl=core['Controller']('node',holder,'metadata preservation-only');adapter=context.owner_adapter(core)
 actual_owner=adapter.owner(ctl,core,owner_pid=os.getpid());owner={k:actual_owner[k]for k in ('holder','owner_pid','owner_birth','lock_inode','owner_sha256')};assert owner['lock_inode']==inode
 runtime=context.current_runtime({});assert runtime==prep['runtime_before']
 before=observer.observe_current();save('BEFORE-INDEPENDENT.json',before)
 named=save('PUBLISHER-TECHNICAL-QUALIFICATION.json',{'schema':'smart-shadow.metadata-publisher-technical-qualification/v1','actor':TASK,'capacity':'existing deployment single writer and tool maintainer','source_commit':SHA,'operation_id':prep['operation_id'],'controller_sha256':prep['controller']['sha256'],'module_sha256':prep['module']['sha256'],'cow_policy_sha256':prep['cow_policy']['sha256'],'scope':'preservation-only necessary tooling, no Node publication/source/configuration adoption','standing_authority':'user supplied AGENTS: complete already-authorized delivery and necessary tool repair; routine implementation decisions retained','user_approval_of_this_plan':False,'user_acceptance':False,'repository_restriction_approval':'pending; Draft PR, no main merge; armed a660 not installed','review':reference(review)})
 cohort=save('WRITER-COHORT.json',{'schema':ins.SCHEMA+'/writer-cohort','targets':targets['files'],'holder':holder,'unknowns':[],'coverage_semantics':'current authorized publishers for these three exact metadata files; cooperative single writer, not a security boundary against arbitrary same-uid processes','writers':[{'actor':TASK,'entrypoint':str(Path(__file__))+' -> original ss-deploy-main.acquire_lock -> canonical ss-service-controller-install CLI','lock_evidence':{'owner':owner,'formal_lock':str(main.LOCK),'main_source_sha256':digest((G/'scripts/ss-deploy-main.py').read_bytes()),'installer_source_sha256':digest((G/ins.SELF).read_bytes()),'source_lease_generation':1293,'source_lease_id':'f16f656e-f3f6-4ef7-9126-defdd97702ea'}}],'coordinated_scope':{'Root':'sole current source/metadata writer','17':'private candidate only, no install','336':'private four-domain/read-only, Root source lease retained','359':'STOP preserved; no resume','28':'separate configuration owner; no configuration touched'},'node_lifecycle':False})
 cow=ins.file_snapshot(Path(prep['cow_policy']['path']),True)
 binding={'phase':'metadata-current','source_commit':SHA,'owner':owner,'candidate_sha256':prep['controller']['sha256'],'module_sha256':prep['module']['sha256'],'family_sha256':ins.sha(ins.canonical({p:v['sha256']for p,v in runtime['nine'].items()})),'preimage':{k:v.get('sha256')for k,v in preimage.items()},'metadata_current':runtime,'metadata_builder_sha256':prep['source_files'][ins.METADATA_BUILDER],'cow_policy_candidate':cow,'cow_policy_source_sha256':prep['source_files'][ins.COW_SOURCE]}
 phase=save('PRESERVATION-QUALIFICATION.json',{'schema':ins.SCHEMA+'/metadata-current-qualification','binding':binding,'publisher':TASK,'releases':[],'authority':'preservation-only'})
 request={'schema':ins.SCHEMA+'/request','operation_id':prep['operation_id'],'phase':'metadata-current','source_commit':SHA,'owner':owner,'evidence':{'candidate_review':reference(review),'named_approval':reference(named),'writer_cohort':reference(cohort),'phase_qualification':reference(phase)},'evidence_directory':str(LOG),'build_base':prep['build_base'],'candidate':prep['controller'],'module_candidate':prep['module'],'cow_policy_candidate':prep['cow_policy']}
 req=save('REQUEST.json',request)
 def cli(args,out):
  result=subprocess.run([sys.executable,str(G/ins.SELF),*args],cwd=G,capture_output=True);ins.write_new(LOG/(out+'.stdout'),result.stdout);ins.write_new(LOG/(out+'.stderr'),result.stderr);return result
 prepared=cli(['--request',str(req)],'prepare');assert prepared.returncode==0
 plan=json.loads(prepared.stdout);path=save('PLAN.json',plan)
 validation=cli(['--plan',str(path)],'validate');assert validation.returncode==0
 result=cli(['--plan',str(path),'--apply'],'apply');result_value=json.loads(result.stdout)if result.stdout else None
 after=observer.observe_current();save('AFTER-INDEPENDENT.json',after)
 actual={k:ins.target_snapshot(Path(v),k=='cow_policy')for k,v in targets['files'].items()}
 status='unknown'
 if result.returncode==0 and result_value and result_value.get('state')=='installed_code_only':
  assert actual['controller']['sha256']==prep['controller']['sha256'] and actual['cow_policy']['sha256']==prep['cow_policy']['sha256'] and actual['module']==preimage['module']
  for key in ('release','host','node','plist','startup_files','transport_nine','configuration','registry','entity_schema','desktop_execution_schema'):assert before['facts'][key]==after['facts'][key],key
  assert controls_projection(before)==controls_projection(after)
  assert after['actual_api']['health']['status']=='ok';status='installed_code_only'
 receipt=save('RECEIPT.json',{'schema':'smart-shadow.controller-metadata-install/v1','status':status,'operation_id':prep['operation_id'],'source_commit':SHA,'build':reference(PREP),'plan':reference(path),'review':reference(review),'publisher_qualification':reference(named),'writer_cohort':reference(cohort),'phase_qualification':reference(phase),'before_sha256':preimage['controller']['sha256'],'installed_sha256':actual['controller'].get('sha256'),'module_unchanged':actual['module']==preimage['module'],'helper_actual_sha256':actual['cow_policy'].get('sha256'),'installer_exit_code':result.returncode,'installer_result':result_value,'before_stats':before['actual_api']['stats'],'after_stats':after['actual_api']['stats'],'before_observation':reference(LOG/'BEFORE-INDEPENDENT.json'),'after_observation':reference(LOG/'AFTER-INDEPENDENT.json'),'driver_node_lifecycle_or_source_or_configuration_calls':False,'observed_runtime_change':any(before['facts'][key]!=after['facts'][key]for key in ('release','host','node','plist','startup_files','transport_nine','configuration','registry','entity_schema','desktop_execution_schema')) or controls_projection(before)!=controls_projection(after),'normal_authority':False,'node_publication':False,'controls_before':controls_projection(before),'controls_after':controls_projection(after),'A_business_accepted':False,'user_acceptance':False,'timestamp':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 print(json.dumps({'status':status,'receipt':reference(receipt)}));assert status=='installed_code_only'
except BaseException as error:
 try:save('FAILURE.json',{'schema':'smart-shadow.metadata-install-failure/v1','error_type':type(error).__name__,'stage':'real metadata preparation/apply/independent readback','no_node_lifecycle_invoked':True,'observed_runtime_change':None,'status':'unknown','error_text_sha256':digest(str(error).encode())})
 except Exception:pass
 raise
finally:
 if owned:
  assert main.LOCK.lstat().st_ino==lock_inode and (main.LOCK/'owner').read_bytes()==lock_bytes,'formal owner changed; foreign lock retained'
  main.release_lock(LOG)
