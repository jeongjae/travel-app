import { useState, type ReactNode } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { timeSpecSchema, type TimeSpec } from '../contracts/v2';
import { ErrorText } from './ui';

type Precision = TimeSpec['precision'];

/**
 * 날짜·시각 입력. 화면에는 `시각 (선택)`만 둔다(비우면 시각 미정, 채우면 현지 시각).
 * 원문 표현·정확한 시점 같은 드문 정밀도와 시간대는 `자세히` 안에서 그대로 편집된다.
 * 사용자가 바꾸기 전에는 값을 다시 내보내지 않으므로 기존 데이터(text/instant 등)가 조용히 바뀌지 않는다.
 */
export function TimeFields({
  value,
  onChange,
  defaultZone,
  fixedDate,
  emptyAs,
  afterTime,
}: {
  value: TimeSpec;
  onChange: (value: TimeSpec) => void;
  /** 여행에 확인된 시간대. 있으면 시간대 칸은 `자세히` 안에만 있다. */
  defaultZone?: string | undefined;
  /** 날짜가 다른 칸(계획 날짜)으로 정해지면 그 값. 없으면 `날짜` 칸을 보인다. */
  fixedDate?: string;
  /** 시각 칸이 비었을 때: 계획은 시각 미정, 기록은 날짜만 확인. */
  emptyAs: 'unspecified' | 'date';
  /** 시각 칸 바로 아래(자세히 접기 앞)에 놓을 칸. 계획의 종료 시각. */
  afterTime?: ReactNode;
}) {
  const [precision, setPrecision] = useState<Precision>(value.precision),
    [date, setDate] = useState(value.date ?? fixedDate ?? ''),
    [localTime, setLocalTime] = useState('localTime' in value ? value.localTime.slice(0, 5) : ''),
    [zone, setZone] = useState('timeZone' in value ? (value.timeZone ?? '') : (defaultZone ?? '')),
    [offset, setOffset] = useState('offset' in value ? value.offset : ''),
    [raw, setRaw] = useState(value.rawText ?? ''),
    [error, setError] = useState('');
  const showDate = fixedDate === undefined;
  const zoneIsDefault = Boolean(defaultZone);
  function automatic(clock: string, day: string): Precision {
    if (clock) {
      return 'local';
    }
    return emptyAs === 'date' && day ? 'date' : 'unspecified';
  }
  function update(fields: {
    precision?: Precision;
    date?: string;
    localTime?: string;
    zone?: string;
    offset?: string;
    raw?: string;
  }) {
    const d = fields.date ?? date,
      l = fields.localTime ?? localTime,
      z = fields.zone ?? zone,
      o = fields.offset ?? offset,
      r = fields.raw ?? raw;
    const manual = ['text', 'instant'].includes(fields.precision ?? precision);
    const p = fields.precision ?? (manual ? precision : automatic(l, d));
    setPrecision(p);
    const day = showDate ? d : (fixedDate ?? d);
    let candidate: unknown;
    try {
      if (p === 'unspecified') {
        candidate = { precision: p, ...(day && showDate ? { date: day } : {}) };
      } else if (p === 'date') {
        candidate = { precision: p, date: day };
      } else if (p === 'text') {
        candidate = { precision: p, ...(day ? { date: day } : {}), rawText: r };
      } else if (p === 'local') {
        candidate = {
          precision: p,
          date: day,
          localTime: l,
          timeZoneStatus: z ? 'confirmed' : 'unknown',
          ...(z ? { timeZone: z } : {}),
        };
      } else {
        const instant = Temporal.ZonedDateTime.from(`${day}T${l}${o}[${z}]`, {
          offset: 'reject',
          disambiguation: 'reject',
        })
          .toInstant()
          .toString();
        candidate = { precision: p, date: day, localTime: l, timeZone: z, offset: o, instant };
      }
      onChange(timeSpecSchema.parse(candidate));
      setError('');
    } catch {
      setError('날짜·시각·시간대를 모두 확인하세요. 유효한 값을 입력한 뒤 저장할 수 있습니다.');
      onChange((candidate as TimeSpec) ?? ({ precision: p } as TimeSpec));
    }
  }
  const needsZone = precision === 'local' || precision === 'instant';
  return (
    <>
      {showDate ? (
        <label>
          날짜
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              update({ date: e.target.value });
            }}
          />
        </label>
      ) : null}
      <label>
        시각 (선택)
        <input
          type="time"
          value={localTime}
          onChange={(e) => {
            setLocalTime(e.target.value);
            update({ localTime: e.target.value });
          }}
        />
      </label>
      {needsZone && !zoneIsDefault ? (
        <label>
          시간대 (예: Asia/Tokyo)
          <input
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              update({ zone: e.target.value });
            }}
            placeholder="Asia/Tokyo"
          />
        </label>
      ) : null}
      {afterTime}
      <details>
        <summary>자세히</summary>
        <label>
          시각 정밀도
          <select value={precision} onChange={(e) => update({ precision: e.target.value as Precision })}>
            <option value="unspecified">시각 미상</option>
            <option value="date">날짜만 확인</option>
            <option value="text">원문 표현</option>
            <option value="local">현지 시각</option>
            <option value="instant">정확한 시점</option>
          </select>
        </label>
        {precision === 'text' ? (
          <label>
            시각 원문
            <input
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                update({ raw: e.target.value });
              }}
              placeholder="점심 후"
            />
          </label>
        ) : null}
        {precision === 'instant' ? (
          <label>
            확인된 UTC 오프셋
            <input
              value={offset}
              onChange={(e) => {
                setOffset(e.target.value);
                update({ offset: e.target.value });
              }}
              placeholder="+09:00"
            />
          </label>
        ) : null}
        {zoneIsDefault ? (
          <label>
            {`시간대: ${defaultZone} (여행 기본)`}
            <input
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                update({ zone: e.target.value });
              }}
            />
          </label>
        ) : null}
      </details>
      <ErrorText error={error} />
    </>
  );
}
