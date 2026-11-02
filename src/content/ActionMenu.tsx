import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export type MenuAction = {
  label: string;
  /** 화면낭독기용 이름. 같은 화면에 같은 메뉴가 여러 개이므로 대상 이름을 포함한다. */
  ariaLabel?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

/**
 * 드문 동작을 한 단계 안에 모으는 `⋯` 메뉴. 열고 닫는 단추(aria-expanded)와 일반 단추 목록으로 구성한다.
 * 바깥을 누르거나 Esc를 누르면 닫히고 초점은 `⋯` 단추로 돌아간다.
 */
export function ActionMenu({
  label,
  actions,
  children,
}: {
  label: string;
  actions: MenuAction[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) {
      return;
    }
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  return (
    <div className="action-menu" ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className="menu-toggle"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open ? (
        <div className="action-menu-panel" id={panelId} ref={panelRef}>
          {children}
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className={action.danger ? 'danger' : undefined}
              aria-label={action.ariaLabel}
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
