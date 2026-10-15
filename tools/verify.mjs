import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(Number(process.versions.node.split('.')[0])<24)throw Error('请安装 Node.js 24 或更新版本后重试。');
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1'};
function run(args,extra={}) {
 const cli=process.env.npm_execpath;
 const command=cli?process.execPath:(process.platform==='win32'?'npm.cmd':'npm');
 const argv=cli?[cli,...args]:args;
 console.log('> npm '+args.join(' '));
 const p=spawnSync(command,argv,{cwd:root,env:{...env,...extra},stdio:'inherit',shell:!cli&&process.platform==='win32'});
 if(p.error)throw p.error;
 if(p.status!==0)process.exit(p.status||1);
}
for(const dir of ['runtime','recovered-source','checks'])run(['ci','--prefix',dir,'--no-audit','--no-fund']);
run(['--prefix','recovered-source','run','build'],{DATABASE_URL:'postgresql://demo:demo@127.0.0.1:1/demo',POSTGRES_URL:''});
run(['--prefix','checks','test']);
run(['--prefix','checks','run','test:source']);
console.log('验证完成：历史源码构建通过，两套代码核心检查通过。结果见 checks。完整现网源码、外部服务和安全审计不在此验证范围。');
