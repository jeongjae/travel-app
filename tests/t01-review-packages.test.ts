import { describe, expect, it } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestBytes } from '../src/contracts/v2';
import { readPackage } from '../src/transfer/package';
import { buildReviewPackages } from './fixtures/review-packages';

/**
 * 사람 검토용 가상 패키지 생성 도구. 환경변수 T01_REVIEW_OUT이 있을 때만 파일을 쓴다.
 *   T01_REVIEW_OUT=.cache/t01-review pnpm exec vitest run tests/t01-review-packages.test.ts
 * 평소 `pnpm run test`에서는 건너뛴다. 출력은 Git 제외 경로(.cache/)에만 둔다.
 */
const outputDirectory = process.env.T01_REVIEW_OUT;

describe.skipIf(!outputDirectory)('T-01 검토용 가상 패키지 생성', () => {
  it('귀국일·이동일·Fact 패키지와 manifest를 쓰고 다시 읽을 수 있다', async () => {
    const directory = resolve(outputDirectory!);
    expect(directory).toContain('.cache');
    await mkdir(directory, { recursive: true });
    const manifest = [];
    for (const item of await buildReviewPackages()) {
      const bytes = new Uint8Array(await item.blob.arrayBuffer());
      await writeFile(resolve(directory, item.fileName), bytes);
      const reread = await readPackage(new Blob([bytes]));
      expect(reread.dataset.header.tripId).toBe(item.tripId);
      manifest.push({
        fileName: item.fileName,
        bytes: bytes.length,
        sha256: await digestBytes(bytes),
        tripId: item.tripId,
        tripName: item.tripName,
        lineageId: item.lineageId,
        role: item.role,
        fixtureFunction: item.fixtureFunction,
        datasetSha256: item.datasetSha256,
      });
    }
    await writeFile(
      resolve(directory, 'manifest.json'),
      JSON.stringify({ fictional: true, note: '실제 여행·예약·사진·키 없음', packages: manifest }, null, 2),
    );
    expect(manifest).toHaveLength(4);
  });
});
