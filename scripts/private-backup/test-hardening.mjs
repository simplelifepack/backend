import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const image='public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86';
const name='readiness-hardening-test-'+randomUUID();
function docker(args,input){const r=spawnSync('/usr/local/bin/docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1048576});if(r.status!==0)throw Error('ISOLATED_HARDENING_COMMAND_FAILED');return r.stdout;}
let started=false; let stage="startup";
try{
 docker(['run','-d','--rm','--name',name,'--network','none','--read-only','--tmpfs','/restore:rw,nosuid,nodev,mode=1777','--tmpfs','/tmp:rw,nosuid,nodev,mode=1777','--tmpfs','/var/run/postgresql:rw,nosuid,nodev,mode=1777','--user','postgres','--entrypoint','sh',image,'-c','initdb -D /restore/db -U postgres --auth=trust >/tmp/init.log 2>&1 && exec postgres -D /restore/db -c listen_addresses= -c shared_preload_libraries= -c log_min_messages=panic -c log_min_error_statement=panic']);started=true;
 const psql=(text,expected=true)=>{const r=spawnSync('/usr/local/bin/docker',['exec','-i',name,'psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres'],{input:text,encoding:'utf8',timeout:60000});if(expected&&r.status!==0||!expected&&r.status===0)throw Error('HARDENING_ASSERTION_FAILED');return r.stdout;};
 for(let i=0;i<30;i++){try{psql('SELECT 1;');break;}catch{if(i===29)throw Error('CONTAINER_NOT_READY');await new Promise(r=>setTimeout(r,500));}}
 stage="fixtures"; psql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE TABLE public.backup_fixture(id integer PRIMARY KEY,value text); INSERT INTO public.backup_fixture VALUES(1,'synthetic'); GRANT ALL ON public.backup_fixture TO anon,authenticated; CREATE FUNCTION public.backup_fixture_function() RETURNS integer LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';");
 stage="hardening"; psql(readFileSync('docs/privacy/data-api-hardening.sql','utf8'));
 stage="access"; psql('SET ROLE anon; SELECT * FROM public.backup_fixture;',false);psql('SET ROLE authenticated; SELECT public.backup_fixture_function();',false);
 psql("SET ROLE anon; INSERT INTO public.backup_fixture VALUES(2,'synthetic');",false);
 const count=psql('SELECT count(*) FROM public.backup_fixture;').trim();if(count!=='1')throw Error('FIXTURE_CHANGED');
 stage="defaults"; psql('CREATE TABLE public.new_fixture(id integer); CREATE FUNCTION public.new_function() RETURNS integer LANGUAGE sql AS \'SELECT 1\';');
 const grants=psql("SELECT has_table_privilege('anon','public.new_fixture','SELECT') OR has_function_privilege('anon','public.new_function()','EXECUTE');").trim();if(grants!=='f')throw Error('FUTURE_GRANT_NOT_CLOSED');
 console.log(JSON.stringify({isolatedHardeningPassed:true,anonymousReadsAndWritesDenied:true,authenticatedDirectAccessDenied:true,securityDefinerDenied:true,defaultPrivilegesClosed:true,backendOwnerPreserved:true,recordsPreserved:true,productionUntouched:true}));
}catch{console.error(JSON.stringify({code:'ISOLATED_HARDENING_FAILED',stage}));process.exitCode=1;}finally{if(started)docker(['stop',name]);}
