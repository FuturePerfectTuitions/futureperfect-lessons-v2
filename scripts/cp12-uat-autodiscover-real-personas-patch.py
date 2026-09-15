from pathlib import Path

p = Path('scripts/cp12-approved-v2-ui-production-uat.mjs')
s = p.read_text()

if "import { spawnSync } from 'node:child_process';" not in s:
    anchor = "import path from 'node:path';\n"
    if s.count(anchor) != 1:
        raise SystemExit('Expected path import anchor once.')
    s = s.replace(anchor, anchor + "import { spawnSync } from 'node:child_process';\n", 1)

old = """if(!base||!expectedJs)throw new Error('Production UI UAT base/bundle inputs are incomplete.');
const vrPersona=persona('VR',{answerRequired:true});
const ordinaryPersona=persona('ORDINARY');
"""
if old not in s:
    raise SystemExit('Expected production UAT persona construction anchor not found.')

new = """function populateRealStudentPersonasIfNeeded(){
  if(String(process.env.UAT_VR_USERNAME||'').trim()&&String(process.env.UAT_ORDINARY_USERNAME||'').trim())return;
  const studentsKv=String(process.env.STUDENTS_KV_ID||process.env.EXPECTED_STUDENTS_KV||'').trim();
  const account=String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const token=String(process.env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!studentsKv||!account||!token)throw new Error('Real production UAT personas were not supplied and protected read credentials are unavailable.');
  const secretPath='/tmp/cp12-production-real-persona-secrets-uat.json';
  const summaryPath='/tmp/cp12-production-real-persona-prereq-uat.json';
  fs.rmSync(secretPath,{force:true});
  const run=spawnSync(process.execPath,['scripts/cp12-production-real-persona-prereq.mjs'],{
    cwd:process.cwd(),
    env:{...process.env,STUDENTS_KV_ID:studentsKv,CP12_PERSONA_SECRETS:secretPath,CP12_PERSONA_SUMMARY:summaryPath},
    encoding:'utf8',
    stdio:['ignore','pipe','pipe']
  });
  if(run.status!==0)throw new Error(`Real production UAT persona discovery failed with exit ${run.status}.`);
  const selected=JSON.parse(fs.readFileSync(secretPath,'utf8'));
  const rows=[['VR',selected.vr],['ORDINARY',selected.ordinary]];
  for(const [prefix,row] of rows){
    if(!row)throw new Error(`Missing ${prefix} real production UAT persona.`);
    process.env[`UAT_${prefix}_USERNAME`]=String(row.username||'');
    process.env[`UAT_${prefix}_LOGIN_PASSWORD`]=String(row.password||'');
    process.env[`UAT_${prefix}_ANSWER_PASSWORD`]=String(row.answerPassword||'');
    process.env[`UAT_${prefix}_EXPECTED_FIRST_NAME`]=String(row.firstName||'');
  }
  fs.rmSync(secretPath,{force:true});
  const summary=JSON.parse(fs.readFileSync(summaryPath,'utf8'));
  if(summary.marker!=='CP12_PRODUCTION_REAL_PERSONA_PREREQ_READONLY_PASS'||summary.productionMutation!==false)throw new Error('Real production UAT persona discovery did not prove the read-only prerequisite.');
  console.log('CP12_PRODUCTION_UAT_REAL_PERSONA_AUTODISCOVERY_PASS');
}
if(!base||!expectedJs)throw new Error('Production UI UAT base/bundle inputs are incomplete.');
populateRealStudentPersonasIfNeeded();
const vrPersona=persona('VR',{answerRequired:true});
const ordinaryPersona=persona('ORDINARY');
"""
s = s.replace(old, new, 1)

required = [
    "spawnSync(process.execPath,['scripts/cp12-production-real-persona-prereq.mjs']",
    'CP12_PRODUCTION_UAT_REAL_PERSONA_AUTODISCOVERY_PASS',
    "process.env[`UAT_${prefix}_USERNAME`]",
    "if(vrPersona.username.toLowerCase()==='admin'",
]
for token in required:
    if token not in s:
        raise SystemExit(f'Missing post-patch token: {token}')

p.write_text(s)
print('CP12_PRODUCTION_UAT_AUTODISCOVERY_SOURCE_PATCH_PASS')
