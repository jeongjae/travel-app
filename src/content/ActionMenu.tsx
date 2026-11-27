import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 패널과 단추 사이 간격(`action-menu-panel`의 4px). */
const PANEL_GAP = 4;

/** 메뉴가 내려올 수 있는 아래 끝: 보이는 하단 탭 줄의 위쪽, 없으면 창 아래 끝. */
function bottomLimit() {
  const nav = document.querySelector('.journey-bottomnav');
  const navTop = nav?.getBoundingClientRect().top;
  if (navTop !== undefined && navTop > 0 && navTop < window.innerHeight) {
    return navTop;
  }
  return window.innerHeight;
}

/** 아래에 들어가지 않고 위에는 들어가면 위로 연다. 위·아래 모두 모자라면 아래로 연다. */
export function shouldOpenUp(toggle: { top: number; bottom: number }, panelHeight: number, limit: number) {
  const below = limit - toggle.bottom - PANEL_GAP;
  const above = toggle.top - PANEL_GAP;
  return panelHeight > below && panelHeight <= above;
}

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
  caption,
  actions,
  children,
}: {
  label: string;
  /** 있으면 `⋯` 옆에 보이는 글자. 없으면 `⋯`만 보인다. */
  caption?: string;
  actions: MenuAction[];
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // 그리기 전에 방향을 정한다. 아래 공간(하단 탭 줄 또는 창 아래 끝까지)이 모자라고 위에는 들어가면 위로 연다.
  useLayoutEffect(() => {
    if (!open) {
      setOpensUp(false);
      return;
    }
    const toggle = toggleRef.current;
    const panel = panelRef.current;
    if (!toggle || !panel) {
      return;
    }
    setOpensUp(shouldOpenUp(toggle.getBoundingClientRect(), panel.offsetHeight, bottomLimit()));
  }, [open]);
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
        {caption ? <span>{caption}</span> : <span aria-hidden="true">⋯</span>}
      </button>
      {open ? (
        <div className={opensUp ? 'action-menu-panel opens-up' : 'action-menu-panel'} id={panelId} ref={panelRef}>
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
