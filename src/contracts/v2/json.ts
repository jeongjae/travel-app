import { ensure } from './primitives.ts';

/** External JSON boundary: JSON.parse alone loses duplicate (including escaped) keys. */
export function parseStrictJson(input: string, maxBytes = 512 * 1024): unknown {
  ensure(new TextEncoder().encode(input).byteLength <= maxBytes, '$', 'JSON 바이트 한도 초과.', 'LIMIT_EXCEEDED');
  let pos = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(input[pos] ?? '\0')) pos++; };
  const fail = (message: string): never => { throw new SyntaxError(`JSON ${pos}: ${message}`); };
  const string = (): string => {
    const start = pos++; let escaped = false;
    while (pos < input.length) {
      const c = input[pos++];
      if (!escaped && c === '"') return JSON.parse(input.slice(start, pos)) as string;
      if (!escaped && c === '\\') escaped = true; else escaped = false;
    }
    return fail('문자열 종료 누락');
  };
  const value = (depth: number): unknown => {
    ensure(depth <= 100, '$', 'JSON 중첩 한도 초과.', 'LIMIT_EXCEEDED'); ws();
    const c = input[pos];
    if (c === '"') return string();
    if (c === '{') {
      pos++; ws(); const result: Record<string, unknown> = Object.create(null); const keys = new Set<string>();
      if (input[pos] === '}') { pos++; return result; }
      while (true) {
        ws(); if (input[pos] !== '"') return fail('객체 키 필요'); const k = string();
        ensure(!keys.has(k), `$[${JSON.stringify(k)}]`, '중복 JSON 객체 키.', 'DUPLICATE_ID'); keys.add(k);
        ws(); if (input[pos++] !== ':') return fail('콜론 필요'); result[k] = value(depth + 1); ws();
        const delimiter = input[pos++]; if (delimiter === '}') return result; if (delimiter !== ',') return fail('객체 구분자 필요');
      }
    }
    if (c === '[') {
      pos++; ws(); const result: unknown[] = []; if (input[pos] === ']') { pos++; return result; }
      while (true) { result.push(value(depth + 1)); ws(); const delimiter = input[pos++]; if (delimiter === ']') return result; if (delimiter !== ',') return fail('배열 구분자 필요'); }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(input.slice(pos))?.[0];
    if (!token) return fail('잘못된 값'); pos += token.length;
    const parsed: unknown = JSON.parse(token);
    ensure(typeof parsed !== 'number' || Number.isFinite(parsed) && (!Number.isInteger(parsed) || Number.isSafeInteger(parsed)), '$', '유한한 안전 범위 숫자가 필요합니다.'); return parsed;
  };
  const result = value(0); ws(); if (pos !== input.length) return fail('남은 입력'); return result;
}

/** Fingerprint v2 canonical JSON: recursive key sort; array and string contents preserved. */
export function canonicalJson(value: unknown): string {
  const visit = (v: unknown, depth: number): string => {
    ensure(depth <= 100, '$', 'JSON 중첩 한도 초과.', 'LIMIT_EXCEEDED');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number') { ensure(Number.isFinite(v) && (!Number.isInteger(v) || Number.isSafeInteger(v)), '$', '유한한 안전 범위 숫자가 필요합니다.'); return JSON.stringify(v); }
    ensure(typeof v === 'object' && v !== null, '$', 'JSON 이외 값은 허용하지 않습니다.');
    if (Array.isArray(v)) {
      ensure(Object.keys(v).length === v.length && Object.keys(v).every((k, i) => k === String(i)), '$', '희소 배열/추가 속성은 허용하지 않습니다.');
      return `[${v.map(x => visit(x, depth + 1)).join(',')}]`;
    }
    ensure(Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null, '$', 'JSON 객체가 필요합니다.');
    ensure(Reflect.ownKeys(v).length === Object.keys(v).length && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => 'value' in d), '$', '숨은 속성/접근자는 허용하지 않습니다.');
    const object = v as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${visit(object[k], depth + 1)}`).join(',')}}`;
  };
  return visit(value, 0);
}
export async function digestBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
