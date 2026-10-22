import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalJson, commandFingerprint, timeSpecSchema } from '../src/contracts/v2/index.ts';
// Native Node 24 TypeScript loading probe, independent of Vitest/Vite transforms.
assert.deepEqual(timeSpecSchema.parse({ precision: 'unspecified' }), { precision: 'unspecified' });
const command = { format: 'travel-app-command', commandVersion: 2, tripId: 'fixture-a', requestId: 'request', normalizationVersion: 'pilot-v1', kind: 'ImportNewTrip', payload: { packageId: 'pkg', packageDigest: '0'.repeat(64) } };
assert.equal(await commandFingerprint(command), createHash('sha256').update(canonicalJson(command)).digest('hex'));
console.log('P-01 native Node 계약 로딩·fingerprint 검사 통과');
