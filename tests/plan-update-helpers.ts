import { readFileSync } from 'node:fs';
import { expect } from 'vitest';
import type { PlanVersion } from '../src/contracts/v2';
import type { CheckedPlanFile } from '../src/plan-import';
import { splitTableRow } from '../src/plan-import/table';
import { computeUpdate, exportPlan, type CurrentTrip, type UpdateResult } from '../src/plan-update';
import { check, createdTrip } from './plan-import-helpers';

export type Created = ReturnType<typeof createdTrip>;
export type Ready = Extract<UpdateResult, { status: 'ready' }>;

/** 가져오기 결과(저장 전)를 "지금 열려 있는 여행"으로 본다. */
export function currentOf(created: Created, placeNames?: ReadonlyMap<string, string>): CurrentTrip {
  const plan: PlanVersion = {
    ...structuredClone(created.initialPlan),
    commitSeq: 1,
    createdAt: '2027-01-01T00:00:00Z',
  };
  return { header: structuredClone(created.header), plan, placeNames };
}

export function ready(result: UpdateResult): Ready {
  if (result.status !== 'ready') {
    throw new Error(`적용 불가: ${result.message}`);
  }
  return result;
}

/** 내보낸 글을 그대로 다시 가져왔을 때 변경 계산 결과가 0건이다(AC-04). */
export function expectZeroChanges(created: Created, again: CheckedPlanFile, includeReservation = false) {
  const current = currentOf(created);
  expect(again.kind).toBe('update');
  expect(again.issues).toEqual([]);
  expect(again.dropped).toEqual([]);
  expect(again.deletions).toEqual([]);
  const result = ready(computeUpdate(again, current));
  expect(result.changes).toEqual([]);
  expect(result.skipped).toEqual([]);
  expect(result.errors).toEqual([]);
  expect(result.ignored).toEqual([]);
  expect(result.unchanged).toHaveLength(created.initialPlan.items.length + created.initialPlan.stays.length);
  const reExported = exportPlan({ header: created.header, plan: created.initialPlan }, { includeReservation });
  expect(reExported.text).toContain(`- 기준revision: ${created.header.domainRevision}`);
}

export const ACTIVITY_COLUMNS = ['ID', '시간', '제목', '종류', '장소', '메모', '예약', '링크'] as const;
type ActivityColumn = (typeof ACTIVITY_COLUMNS)[number];

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|');
}

/** 내보낸 글에서 ID 줄의 칸을 바꾼다. 값 `'(비움)'`은 지우기 표시다. */
export function rewriteRow(text: string, id: string, patch: Partial<Record<ActivityColumn, string>>) {
  return text
    .split('\n')
    .map((line) => {
      if (!line.startsWith(`| ${id} |`)) {
        return line;
      }
      const cells = splitTableRow(line);
      (Object.entries(patch) as [ActivityColumn, string][]).forEach(([name, value]) => {
        cells[ACTIVITY_COLUMNS.indexOf(name)] = value;
      });
      return `| ${cells.map(escapeCell).join(' | ')} |`;
    })
    .join('\n');
}

/** 내보낸 글의 머리 7줄(여행ID·기준계획·기준revision 포함)만 가져온다. */
export function headLines(text: string) {
  return text.split('\n').slice(0, 7).join('\n');
}

export const ACTIVITY_TABLE_HEADER =
  '| ID | 시간 | 제목 | 종류 | 장소 | 메모 | 예약 | 링크 |\n|---|---|---|---|---|---|---|---|';

/** 바뀐 줄만 담은 수정 글을 만든다(돌려주지 않은 줄은 변경 없음). */
export function partialUpdate(
  text: string,
  options: { days?: { heading: string; rows: string[] }[]; stays?: string[]; deletions?: [string, string, string][] },
) {
  const parts = [headLines(text), '', '## 일정'];
  for (const day of options.days ?? []) {
    parts.push(`### ${day.heading}`, ACTIVITY_TABLE_HEADER, ...day.rows, '');
  }
  if (options.stays) {
    parts.push(
      '## 숙소',
      '| ID | 체크인 | 체크아웃 | 이름 | 지역 | 예약 |',
      '|---|---|---|---|---|---|',
      ...options.stays,
      '',
    );
  }
  if (options.deletions) {
    parts.push(
      '## 삭제',
      '| 종류 | ID | 제목 |',
      '|---|---|---|',
      ...options.deletions.map(([kind, id, title]) => `| ${kind} | ${id} | ${title} |`),
    );
  }
  return parts.join('\n');
}

export function updateOf(text: string) {
  return check(text);
}

export function exampleSapporoText() {
  return readFileSync('docs/examples/plan-export-sapporo.md', 'utf8').replace(/\r\n/g, '\n');
}
