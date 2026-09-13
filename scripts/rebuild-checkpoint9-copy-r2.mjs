import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const planPath=process.env.CHECKPOINT9_R2_COPY_PLAN||'/tmp/checkpoint9-r2-copy-plan.json';
const wrangler=process.env.WRANGLER_BIN||path.resolve('node_modules/.bin/wrangler');
const plan=JSON.parse(fs.readFileSync(planPath,'utf8'));
const source=String(plan?.sourceBucket||'').trim();
const destination=String(plan?.destinationBucket||'').trim();
const keys=[...new Set(Array.isArray(plan?.keys)?plan.keys.map(v=>String(v||'').trim()).filter(Boolean):[])];
if(!source||!destination||!keys.length) throw new Error('Checkpoint 9 R2 copy plan is incomplete.');
if(source===destination) throw new Error('Checkpoint 9 R2 source and staging destination must differ.');
if(!/rebuild.*staging/i.test(destination)) throw new Error('Checkpoint 9 R2 destination is not an isolated rebuild staging bucket.');
if(!fs.existsSync(wrangler)) throw new Error(`Wrangler binary unavailable at ${wrangler}`);

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'fpt-cp9-r2-'));
let bytes=0;
const copied=[];

function run(args){
  const result=spawnSync(wrangler,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:process.env});
  if(result.status!==0){
    const safe=(result.stderr||result.stdout||'').split('\n').filter(line=>!line.includes('CLOUDFLARE')).slice(-12).join('\n');
    throw new Error(`Wrangler failed (${args.slice(0,4).join(' ')}): ${safe}`);
  }
}

try{
  for(const key of keys){
    const digest=crypto.createHash('sha256').update(key).digest('hex');
    const file=path.join(tempRoot,`${digest}.bin`);
    run(['r2','object','get',`${source}/${key}`,'--file',file,'--remote']);
    const stat=fs.statSync(file);
    if(!stat.isFile()||stat.size<=0) throw new Error(`Production R2 source object was empty or unavailable: ${digest.slice(0,12)}`);
    run(['r2','object','put',`${destination}/${key}`,'--file',file,'--remote']);
    bytes+=stat.size;
    copied.push({keyHash:digest.slice(0,16),bytes:stat.size});
  }
}finally{
  fs.rmSync(tempRoot,{recursive:true,force:true});
}

const summary={marker:'REBUILD_CHECKPOINT9_R2_COPY_PASS',sourceReadOnly:true,destinationIsolated:true,objectCount:copied.length,totalBytes:bytes,objects:copied};
fs.writeFileSync('/tmp/checkpoint9-r2-copy-summary.json',JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
