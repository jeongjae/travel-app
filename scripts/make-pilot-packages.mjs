import { mkdir, writeFile } from 'node:fs/promises';
import { pilotTrip, fixtureAssets } from '../tests/fixtures/pilot.ts';
import { digestBytes } from '../src/contracts/v2/index.ts';
import { buildPackage } from '../src/transfer/package.ts';
await mkdir('public/pilot', { recursive: true });
const assets = new Map();
for (const b of Object.values(fixtureAssets)) assets.set(await digestBytes(b), b);
for (const short of [false, true]) {
  const t = await pilotTrip(short),
    p = await buildPackage(
      t,
      assets,
      {
        sourceRepository: 'synthetic/pilot',
        sourceCommit: 'synthetic-v1',
        lineageId: 'synthetic-pilot',
        adapterVersion: '1',
        normalizationVersion: 'pilot-v1',
      },
      { synthetic: true, blocking: [] },
    );
  await writeFile(`public/pilot/${t.header.tripId}.zip`, new Uint8Array(await p.blob.arrayBuffer()));
  console.log(`${t.header.tripId}: ${p.blob.size} bytes`);
}
