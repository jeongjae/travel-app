import { CHOICE_LABEL, type Selections } from '../guide-import/selection';
import type { PrepState } from '../guide-import/draft';

type Props = { guide: NonNullable<PrepState['guide']>; selections: Selections };

/**
 * 준비 초안에서 고른 `꼭 포함`·`제외` 목록. 사람이 계획과 대조하라고 보여 줄 뿐,
 * 앱이 반영 여부를 판정하거나 계획을 고치지 않는다. 고른 것이 없으면 아무것도 그리지 않는다.
 */
export function ChosenList({ guide, selections }: Props) {
  const groups = (['must', 'exclude'] as const)
    .map((choice) => ({ choice, items: guide.items.filter((item) => selections[item.key] === choice) }))
    .filter((group) => group.items.length > 0);
  if (groups.length === 0) {
    return null;
  }
  return (
    <section aria-label="내가 고른 것" className="chosen-list">
      <h3>내가 고른 것 — 계획에 반영됐는지 확인하세요</h3>
      <p className="muted">꼭 포함·제외만 보여 줍니다. 관심은 넣지 않습니다.</p>
      {groups.map((group) => (
        <div key={group.choice}>
          <h4>
            {CHOICE_LABEL[group.choice]} {group.items.length}개
          </h4>
          <ul>
            {group.items.map((item) => (
              <li key={item.key}>
                {item.name}
                {item.area ? ` (${item.area})` : ''}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
