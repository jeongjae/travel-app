import type { ContentRevision, PlanVersion } from '../contracts/v2/index.ts';
import {
  sourceObject,
  sourceText,
  tableText,
  section,
  type SourceExtract,
  type SourceCoverage,
  type Section,
} from './spfr-source.ts';

export const workbookPath = 'source/OPERATIONS/TP_Europe_Travel_Master_Tracker_v1.2.xlsx';
type Cell = { sourceKey: string; column: string; row: number; value: unknown; raw: Record<string, unknown> };
const sheets = [
  'Lists',
  'Master Itinerary',
  'Reservations',
  'Transport',
  'Accommodation',
  'Assets',
  'Publication QA',
  'Dashboard',
  'Detailed Maps',
  'Photo Rights',
  'Field Shots',
  'Phase8 Lock Status',
];
const dayValue = (value: unknown) => {
  if (value && typeof value === 'object' && 'isoValue' in value) {
    return sourceText(value.isoValue).slice(0, 10);
  }
  return sourceText(value);
};

/** Keeps workbook values separately from daily-card truth; date and region selection never uses fuzzy matching. */
export function mapSpfrWorkbook(
  extract: SourceExtract,
  coverage: SourceCoverage,
  plan: PlanVersion,
  regions: string[],
  addBooking: (id: string, payload: Extract<ContentRevision, { kind: 'booking' }>['payload'], locator: string) => void,
  fullSourceScope = false,
) {
  const dates = new Set(plan.days.map((day) => day.date));
  const bySheet = new Map<string, Cell[]>();
  for (const entry of extract.entries.filter((entry) => entry.sourceKind === 'xlsx')) {
    const match = /^(.+\.xlsx):([^!]+)!([A-Z]+)(\d+)$/.exec(entry.sourceKey);
    if (!match || match[1] !== workbookPath || !sheets.includes(match[2])) {
      throw new Error(`지원하지 않는 통합문서/시트/셀: ${entry.sourceKey}`);
    }
    const raw = sourceObject(entry.rawValue);
    if (raw.cellType === 'f' && (raw.cachedValue === null || raw.cachedValue === undefined)) {
      throw new Error(`수식 캐시 없는 셀: ${entry.sourceKey}`);
    }
    const cells = bySheet.get(match[2]) ?? [];
    cells.push({
      sourceKey: entry.sourceKey,
      column: match[3],
      row: Number(match[4]),
      value: raw.cellType === 'f' ? raw.cachedValue : raw.value,
      raw,
    });
    bySheet.set(match[2], cells);
  }
  if (sheets.some((sheet) => !bySheet.has(sheet))) {
    throw new Error('필수 XLSX 12시트 중 누락이 있습니다.');
  }
  const sections: Section[] = [];
  const counts: { sheet: string; selectedCells: number; deferredCells: number; rows: number }[] = [];
  for (const [sheetIndex, sheet] of sheets.entries()) {
    const cells = bySheet.get(sheet)!;
    const headerRow = sheet === 'Lists' ? 1 : 3;
    const rows = new Map<number, Cell[]>();
    for (const cell of cells) {
      const row = rows.get(cell.row) ?? [];
      row.push(cell);
      rows.set(cell.row, row);
    }
    const headers = new Map(
      cells.filter((cell) => cell.row === headerRow).map((cell) => [cell.column, sourceText(cell.value)]),
    );
    if (!headers.size) {
      throw new Error(`XLSX 헤더가 없습니다: ${sheet}`);
    }
    const body = [
      '원천 값은 실행 기록이나 확정 예약으로 재해석하지 않습니다.',
      '',
      '| 행 | 열 · 항목 | 원천 값 |',
      '|---|---|---|',
    ];
    let selectedCells = 0;
    let deferredCells = 0;
    let selectedRows = 0;
    for (const [rowNumber, row] of rows) {
      const value = (column: string) => row.find((cell) => cell.column === column)?.value;
      const region = (column: string) => regions.includes(sourceText(value(column)).trim().toLowerCase());
      const regionOrGlobalAsset = () => region('C') || sourceText(value('C')) === '전체';
      const chapter = sourceText(value('B'));
      const selectedChapter =
        /^(?:Part [125] |\d+ )/.test(chapter) &&
        (chapter.startsWith('Part ') || regions.includes(chapter.replace(/^\d+ /, '').split(/[ ·]/)[0].toLowerCase()));
      const global = ['Lists', 'Dashboard', 'Phase8 Lock Status'].includes(sheet);
      const inScope =
        fullSourceScope ||
        rowNumber <= headerRow ||
        global ||
        (['Master Itinerary', 'Field Shots'].includes(sheet) && dates.has(dayValue(value('A')))) ||
        (sheet === 'Transport' && dates.has(dayValue(value('B')))) ||
        (sheet === 'Reservations' && (dates.has(dayValue(value('E'))) || region('C'))) ||
        (sheet === 'Accommodation' &&
          (region('A') ||
            plan.days.some((day) => dayValue(value('B')) <= day.date && day.date < dayValue(value('C'))))) ||
        (sheet === 'Assets' && regionOrGlobalAsset()) ||
        (sheet === 'Publication QA' && selectedChapter) ||
        (['Detailed Maps', 'Photo Rights'].includes(sheet) && region('B'));
      if (rowNumber > headerRow && inScope) {
        selectedRows++;
      }
      for (const cell of row) {
        const disposition = rowNumber <= headerRow ? 'metadata' : inScope ? 'displayed' : 'deferred';
        coverage.mark(
          cell.sourceKey,
          '',
          disposition,
          inScope ? `guide/source-workbook#sheet-${sheetIndex}` : 'Phase 2',
          rowNumber <= headerRow
            ? '시트 제목·열 정의; 화면 표에서 사용'
            : inScope
              ? '3일 날짜·명시 지역 또는 전체 운영 기준 표'
              : '대표 3일/지역 밖의 행; 전체 이행 때 재처리',
        );
        if (inScope) {
          selectedCells++;
          if (rowNumber > headerRow) {
            body.push(
              `| ${rowNumber} | ${cell.column} · ${tableText(headers.get(cell.column) ?? '')} | ${tableText(dayValue(cell.value))} |`,
            );
          }
        } else {
          deferredCells++;
        }
      }
      // A region-scoped reservation without an ISO date is still a source booking, never an invented date.
      if (
        sheet === 'Reservations' &&
        rowNumber > headerRow &&
        (fullSourceScope || dates.has(dayValue(value('E'))) || region('C'))
      ) {
        const sourceId = sourceText(value('A'));
        if (!/^[A-Za-z0-9._:-]+$/.test(sourceId)) {
          throw new Error('명시적인 XLSX 예약 ID가 필요합니다.');
        }
        addBooking(
          `xlsx-${sourceId}`,
          {
            type: sourceText(value('B')) || 'source-reservation',
            title: sourceText(value('D')),
            ...(region('C') ? { regionId: sourceText(value('C')).trim().toLowerCase() } : {}),
            activityIds: [],
            time: {
              start: {
                precision: 'text',
                ...(/^\d{4}-\d{2}-\d{2}$/.test(dayValue(value('E'))) ? { date: dayValue(value('E')) } : {}),
                rawText: [dayValue(value('E')), sourceText(value('F'))].filter(Boolean).join(' · ') || '시각 미상',
              },
            },
            status: sourceText(value('H')) || 'unknown',
            sourceStatusRaw: sourceText(value('H')),
            actionTiming: { precision: 'text', rawText: dayValue(value('I')) || '확인 필요' },
            planB: sourceText(value('T')),
            note: sourceText(value('V')),
            ...(/^https?:\/\//.test(sourceText(value('R'))) ? { officialUrl: sourceText(value('R')) } : {}),
            privateDetails: {
              confirmationCode: sourceText(value('O')),
              address: sourceText(value('Q')),
              note: `사업자: ${sourceText(value('P'))}; 금액: ${sourceText(value('K'))} ${sourceText(value('L'))}; 원천 ID: ${sourceId}`,
            },
          },
          `${workbookPath}:${sheet}!A${rowNumber}`,
        );
      }
    }
    if (!selectedRows) {
      body.push('| — | 대상 행 없음 | 다른 날짜·지역 행은 대응표의 Phase 2 보류에 기록 |');
    }
    sections.push(section(`sheet-${sheetIndex}`, sheet, body.join('\n'), sheetIndex));
    counts.push({ sheet, selectedCells, deferredCells, rows: selectedRows });
  }
  return { sections, counts };
}
