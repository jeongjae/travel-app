import { describe, expect, it } from 'vitest';
import { extendSpan, joinSpans, type SaveSpan } from '../src/plan-update';

function chain(saves: [number, number][]): SaveSpan | undefined {
  return saves.reduce<SaveSpan | undefined>((span, [before, after]) => extendSpan(span, before, after), undefined);
}

describe('저장 구간 잇기', () => {
  it('끼어든 저장이 없으면 만들기와 수정이 하나로 이어진다', () => {
    const created = chain([
      [3, 4],
      [4, 5],
    ]);
    const edited = chain([
      [5, 6],
      [6, 7],
    ]);
    expect(joinSpans(created, edited)).toEqual({ from: 3, to: 7 });
    expect(joinSpans(undefined, edited)).toEqual({ from: 5, to: 7 });
    expect(joinSpans(undefined, undefined)).toBeUndefined();
  });

  it('장소 만들기 뒤 다른 저장이 끼면 연결하지 않는다', () => {
    const created = chain([[3, 4]]);
    const edited = chain([[5, 6]]);
    expect(joinSpans(created, edited)).toBeUndefined();
  });

  it('장소 수정 두 건 사이나 만들기 묶음 사이에 다른 저장이 끼면 연결하지 않는다', () => {
    expect(
      joinSpans(
        chain([
          [5, 6],
          [7, 8],
        ]),
      ),
    ).toBeUndefined();
    expect(
      joinSpans(
        chain([
          [3, 4],
          [5, 6],
        ]),
      ),
    ).toBeUndefined();
    expect(
      joinSpans(
        chain([
          [3, 4],
          [5, 6],
        ]),
        chain([[6, 7]]),
      ),
    ).toBeUndefined();
  });

  it('수정을 먼저 하고 만들기를 나중에 해도 맞닿으면 이어진다', () => {
    expect(joinSpans(chain([[6, 7]]), chain([[5, 6]]))).toEqual({ from: 5, to: 7 });
  });
});
