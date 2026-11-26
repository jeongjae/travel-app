/** 이 화면이 저장한 여행 revision 구간. `broken`이면 구간 사이에 다른 저장이 끼었다. */
export type SaveSpan = { from: number; to: number; broken?: boolean };

/** 저장 한 번(저장 전 revision → 저장 후 revision)을 구간에 잇는다. 저장 전이 직전 구간의 끝과 다르면 끊긴 것으로 표시한다. */
export function extendSpan(span: SaveSpan | undefined, before: number, after: number): SaveSpan {
  if (!span) {
    return { from: before, to: after };
  }
  return { from: span.from, to: after, broken: span.broken === true || before !== span.to };
}

/**
 * 이 화면의 구간들을 하나의 기준 연결로 합친다. 구간이 하나라도 끊겼거나 서로 맞닿지 않으면(앞 구간의 끝 ≠ 뒤 구간의 시작)
 * 사이에 다른 저장이 끼었을 수 있으므로 연결하지 않는다(`undefined`).
 */
export function joinSpans(...parts: (SaveSpan | undefined)[]): { from: number; to: number } | undefined {
  const found = parts.filter((part): part is SaveSpan => part !== undefined).sort((a, b) => a.from - b.from);
  if (found.length === 0 || found.some((part) => part.broken)) {
    return undefined;
  }
  for (let index = 1; index < found.length; index++) {
    if (found[index].from !== found[index - 1].to) {
      return undefined;
    }
  }
  return { from: found[0].from, to: found[found.length - 1].to };
}
