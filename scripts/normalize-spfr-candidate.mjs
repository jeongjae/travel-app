import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {parseArgs} from 'node:util';
import {normalizeSpfrCandidate} from '../src/transfer/spfr-candidate.ts';
import {parseStrictJson} from '../src/contracts/v2/index.ts';
const {values}=parseArgs({options:{extract:{type:'string'},days:{type:'string'},'trip-id':{type:'string'},'output-dir':{type:'string'}}});
if(!values.extract||!values.days||!values['trip-id']||!values['output-dir'])throw new Error('--extract --days 28,29,30 --trip-id --output-dir를 지정하세요.');
// Real source-derived candidates stay outside public/Git, including when this command is rerun.
const privateRoot=await realpath('local-data'),output=resolve(values['output-dir']),rel=relative(privateRoot,output);if(rel.startsWith('..')||isAbsolute(rel))throw new Error('실제 후보 출력은 local-data 아래에만 허용합니다.');
await mkdir(output,{recursive:true});const resolved=await realpath(output),actualRel=relative(privateRoot,resolved);if(actualRel.startsWith('..')||isAbsolute(actualRel))throw new Error('출력 경로가 local-data 밖입니다.');
const result=await normalizeSpfrCandidate(parseStrictJson(await readFile(values.extract,'utf8'),32*1024**2),{days:values.days.split(',').map(Number),tripId:values['trip-id'],createdAt:new Date().toISOString()});
for(const [name,value]of Object.entries(result))await writeFile(resolve(resolved,`${name}.json`),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({contents:result.dataset.contents.length,days:result.dataset.plans[0].days.length,items:result.dataset.plans[0].items.length,blocking:result.report.blocking.length,packageReady:false}));
