import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
const mode=process.argv[2] || 'runtime';
assert(['runtime','recovered-source'].includes(mode));
const appDir=path.join(root,mode);
const results={checkedAt:new Date().toISOString(),mode,databaseEngine:'PGlite (embedded PostgreSQL, not production PostgreSQL 16)',syntheticDataOnly:true,productionDatabaseConnected:false,ossOrModelCallsTested:false,checks:[]};
let db,socket,child,temp,logs='';
const check=(name)=>results.checks.push({name,passed:true});
const freePort=()=>new Promise((resolve,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
try {
 temp=await mkdtemp(path.join(tmpdir(),'ad-handoff-'));
 db=await PGlite.create();
 const sql=(await readFile(path.join(root,'database/schema.sql'),'utf8')).replace(/^\\(?:un)?restrict[^\n]*$/gm,'');
 await db.exec(sql);
 check('Import current schema into empty database');
 const tables=await db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
 assert.equal(tables.rows[0].n,32);check('32 database tables created');
 await db.exec(await readFile(path.join(root,'database/seed-demo.sql'),'utf8'));
 const norm=await db.query('SELECT count(*)::int AS n FROM ad_sources');assert.equal(norm.rows[0].n,2);check('Demo inserts and normalization triggers');
 const dbPort=await freePort(),httpPort=await freePort();
 socket=new PGLiteSocketServer({db,host:'127.0.0.1',port:dbPort,maxConnections:20});await socket.start();
 const env={...Object.fromEntries(["PATH","HOME","TMPDIR","TEMP","TMP","LANG","SYSTEMROOT"].filter(k=>process.env[k]).map(k=>[k,process.env[k]])),NODE_ENV:'production',NEXT_TELEMETRY_DISABLED:'1',HOSTNAME:'127.0.0.1',PORT:String(httpPort),DATABASE_URL:`postgresql://postgres:demo@127.0.0.1:${dbPort}/postgres`,POSTGRES_URL:'',TIKTOK_AD_DATA_DIR:path.join(temp,'data'),OSS_ACCESS_KEY_ID:'',OSS_ACCESS_KEY_SECRET:'',OSS_BUCKET:'',OSS_ENDPOINT:'',OSS_PUBLIC_BASE_URL:'',ARK_API_KEY:'',DOUBAO_API_KEY:'',OPENAI_API_KEY:'',GEMINI_API_KEY:'',WORKSTATION_GW_BASE:'http://127.0.0.1:1'};
 await mkdir(env.TIKTOK_AD_DATA_DIR,{recursive:true});
 const args=mode==='runtime'?['server.js']:['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(httpPort)];
 child=spawn(process.execPath,args,{cwd:appDir,env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>logs+=b.toString());child.stderr.on('data',b=>logs+=b.toString());
 const base=`http://127.0.0.1:${httpPort}/tiktok-ad-assistant`;
 let response;
 for(let i=0;i<60;i++) {try{response=await fetch(base,{signal:AbortSignal.timeout(3000)});if(response.ok)break;}catch{} if(child.exitCode!==null)throw Error('Application exited before readiness');await new Promise(r=>setTimeout(r,500));}
 assert(response?.ok,'Homepage readiness');const html=await response.text();assert(html.includes('<html'));check('Homepage returns HTML');
 const asset=html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+\.(?:js|css))"/);
 assert(asset,'Static asset in homepage');const assetRes=await fetch(new URL(asset[1],base));assert.equal(assetRes.status,200);check('Homepage static asset loads');
 const json=async(url,init)=>{const r=await fetch(base+url,{...init,signal:AbortSignal.timeout(15000)});const t=await r.text();assert(r.ok,`${url}: ${r.status} ${t.slice(0,400)}`);return JSON.parse(t);};
 const list=await json('/api/ads?page=1&pageSize=10');assert(Array.isArray(list.ads));assert(list.ads.some(a=>a.id==='handoff_demo_001'));check('List synthetic ads');
 const detail=await json('/api/ads/handoff_demo_001');assert(JSON.stringify(detail).includes('示例产品 A'));check('Read ad detail');
 await json('/api/ads/handoff_demo_001',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({favorite:true})});
 const fav=await db.query("SELECT favorite FROM ads WHERE id='handoff_demo_001'");assert.equal(fav.rows[0].favorite,true);check('Favorite update persisted');
 await json('/api/ads/handoff_demo_001',{method:'DELETE'});
 const remaining=await db.query("SELECT count(*)::int AS n FROM ads WHERE id='handoff_demo_001'");assert.equal(remaining.rows[0].n,0);
 const cascade=await db.query("SELECT count(*)::int AS n FROM ad_sources WHERE ad_id='handoff_demo_001'");assert.equal(cascade.rows[0].n,0);check('Delete synthetic record and cascade');
 const absent=await fetch(base+'/api/ads/handoff_demo_001');assert.equal(absent.status,404);check('Deleted detail returns 404');
 results.passed=true;
} catch(error) {results.passed=false;results.error=String(error);process.exitCode=1;}
finally {
 if(child){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}
 await writeFile(path.join(here,`${mode}-smoke-results.json`),JSON.stringify(results,null,2)+'\n');
 if(socket){await socket.stop();await new Promise(r=>setTimeout(r,500));}if(db)await db.close();if(temp)await rm(temp,{recursive:true,force:true});
 await writeFile(path.join(here,`${mode}-smoke-results.json`),JSON.stringify(results,null,2)+'\n');
 await writeFile(path.join(here,`${mode}-smoke.log`),logs);
 console.log(JSON.stringify(results,null,2));
}
