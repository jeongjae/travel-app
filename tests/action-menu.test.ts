import { describe, expect, it } from 'vitest';
import { shouldOpenUp } from '../src/content/ActionMenu';

/** T-E3-2b R0: `⋯` 메뉴를 여는 방향. */
describe('shouldOpenUp', () => {
  it('아래 공간이 넉넉하면 아래로 연다', () => {
    expect(shouldOpenUp({ top: 100, bottom: 140 }, 200, 800)).toBe(false);
  });

  it('아래가 모자라고 위에 들어가면 위로 연다', () => {
    expect(shouldOpenUp({ top: 600, bottom: 640 }, 200, 760)).toBe(true);
  });

  it('위·아래 모두 모자라면 아래로 연다', () => {
    expect(shouldOpenUp({ top: 100, bottom: 140 }, 300, 300)).toBe(false);
  });

  it('간격 4px까지 들어가면 아래로 연다', () => {
    expect(shouldOpenUp({ top: 500, bottom: 540 }, 200, 744)).toBe(false);
    expect(shouldOpenUp({ top: 500, bottom: 540 }, 200, 743)).toBe(true);
  });
});
