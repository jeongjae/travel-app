import { expect,it } from 'vitest';
import { mkdir,mkdtemp,writeFile,readFile,copyFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { BlobReader,BlobWriter,ZipReader,ZipWriter,Uint8ArrayReader } from '@zip.js/zip.js';
import { pilotTrip,fixtureAssets } from './fixtures/pilot';
import { buildPackage,readPackage } from '../src/transfer/package';
import { normalizeExtract } from '../src/transfer/normalize';
import { digestBytes,sourceExtractSchema } from '../src/contracts/v2';
const source={sourceRepository:'synthetic/pilot',sourceCommit:'synthetic-v1',lineageId:'synthetic',adapterVersion:'1',normalizationVersion:'pilot-v1'};
const python=resolve(process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python');
async function pack(){const assets=new Map<string,Uint8Array>();for(const bytes of Object.values(fixtureAssets))assets.set(await digestBytes(bytes),bytes);return buildPackage(await pilotTrip(),assets,source);}
it('선택 원천을 실행 없이 읽고 JSON/AST/XLSX를 공유 계약·패키지로 정규화한다',async()=>{
 await mkdir('.cache/transfer-tests',{recursive:true});const dir=await mkdtemp(resolve('.cache/transfer-tests/source-'));await writeFile(join(dir,'trip.json'),JSON.stringify(await pilotTrip()));await copyFile('tests/fixtures/booking_literals.py',join(dir,'booking.py'));
 execFileSync(python,['-c',"import sys,runpy;from pathlib import Path;runpy.run_path('scripts/check-pilot-environment.py')['make_workbook'](Path(sys.argv[1]))",join(dir,'reservations.xlsx')],{stdio:'pipe'});
 await writeFile(join(dir,'spec.json'),JSON.stringify([{path:'trip.json',kind:'json'},{path:'booking.py',kind:'python',constants:['PILOT_BOOKINGS','UNSUPPORTED_BOOKINGS']},{path:'reservations.xlsx',kind:'xlsx'}]));
 const before=await readFile(join(dir,'booking.py'));execFileSync(python,['scripts/extract-source.py','--root',dir,'--spec',join(dir,'spec.json'),'--output',join(dir,'extract.json'),'--repository','synthetic/pilot','--commit','synthetic-v1'],{stdio:'pipe'});
 const extract=sourceExtractSchema.parse(JSON.parse(await readFile(join(dir,'extract.json'),'utf8')));expect(extract.manifest).toHaveLength(3);expect(extract.unresolved.map(e=>e.reason)).toEqual(expect.arrayContaining(['unsupported non-JSON literal/expression','formula cache missing']));expect(await readFile(join(dir,'booking.py'))).toEqual(before);
 const normalized=normalizeExtract(extract,'trip.json',[{mode:'python-booking',sourceKey:'booking.py:PILOT_BOOKINGS',index:0,targetBookingId:'booking-code'},{mode:'xlsx-booking',sourceKey:'reservations.xlsx:Reservations!A2',targetBookingId:'booking-xlsx'}],extract.unresolved.map(e=>e.sourceKey));
 expect(normalized.report.blocking).toEqual([]);expect(normalized.dataset.contents.some(c=>c.kind==='booking'&&c.entityId==='booking-xlsx'&&c.payload.sourceStatusRaw==='미확인')).toBe(true);expect(normalized.dataset.contents.find(c=>c.kind==='booking'&&c.entityId==='booking-code')?.sourceRefs[0].locator).toContain('booking.py:');
 const assets=new Map<string,Uint8Array>();for(const b of Object.values(fixtureAssets))assets.set(await digestBytes(b),b);const p=await buildPackage(normalized.dataset,assets,source,normalized.report,normalized.mappings);expect((await readPackage(p.blob)).dataset.contents.filter(c=>c.kind==='booking')).toHaveLength(2);
},10000);
it('패키지의 모든 NDJSON·첨부 바이트·해시를 왕복하고 취소·미해결 자료를 거부한다',async()=>{
 const p=await pack(),parsed=await readPackage(p.blob);expect(parsed.dataset.header.tripId).toBe('fixture-a');expect(parsed.dataset.contents).toHaveLength((await pilotTrip()).contents.length);expect(parsed.assets.size).toBe(2);expect(parsed.provenance.packageDigest).toBe(p.packageDigest);
 const cancelled=new AbortController();cancelled.abort();await expect(readPackage(p.blob,cancelled.signal)).rejects.toThrow();
 const assets=new Map<string,Uint8Array>();for(const b of Object.values(fixtureAssets))assets.set(await digestBytes(b),b);const blocked=await buildPackage(await pilotTrip(),assets,source,{blocking:['missing-fact']});await expect(readPackage(blocked.blob)).rejects.toThrow('미해결');
});
it('ZIP 경로·symlink·파일 변조를 거부한다',async()=>{
 const p=await pack(),reader=new ZipReader(new BlobReader(p.blob),{useWebWorkers:false}),writer=new ZipWriter(new BlobWriter(),{useWebWorkers:false});
 for(const e of await reader.getEntries()){if(e.directory)continue;const data=await e.getData(new (await import('@zip.js/zip.js')).Uint8ArrayWriter());await writer.add(e.filename,new Uint8ArrayReader(e.filename==='records/trip_headers.ndjson'?new TextEncoder().encode('변조'):data));}await reader.close();await expect(readPackage(await writer.close())).rejects.toThrow('해시');
 const w=new ZipWriter(new BlobWriter(),{useWebWorkers:false});await w.add('../escape',new Uint8ArrayReader(new Uint8Array()));await expect(readPackage(await w.close())).rejects.toThrow(/위험|Unsafe/);
 const symlink=new ZipWriter(new BlobWriter(),{useWebWorkers:false});await symlink.add('link',new Uint8ArrayReader(new TextEncoder().encode('elsewhere')),{unixMode:0o120777});await expect(readPackage(await symlink.close())).rejects.toThrow('위험');
});
