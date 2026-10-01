import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { IconButton } from '../shared/ui';

/** Presentation only: all content and authority continue to come from the live API components. */
export function LiveConversationDeck({
  navigation,
  children,
  source,
  sourceId,
  closeSource,
}: {
  navigation: ReactNode;
  children: ReactNode;
  source?: ReactNode;
  sourceId?: string;
  closeSource: () => void;
}) {
  const [active, setActive] = useState('conversation');
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const sourceTrigger = useRef<HTMLElement | null>(null);
  const fullscreenTrigger = useRef<HTMLElement | null>(null);
  const previousSource = useRef<string | undefined>(undefined);
  const restoreConversationFocus = () => {
    requestAnimationFrame(() => {
      const conversation = scroller.current?.querySelector<HTMLElement>('[data-live-card="conversation"]');
      const trigger = sourceTrigger.current;
      const target =
        trigger?.isConnected && conversation?.contains(trigger)
          ? trigger
          : conversation?.querySelector<HTMLElement>(
              '.conversation-sources button, textarea:not(:disabled), button:not(:disabled)',
            );
      if (target) target.focus({ preventScroll: true });
      else if (conversation) {
        conversation.tabIndex = -1;
        conversation.focus({ preventScroll: true });
      }
    });
  };
  const [edges, setEdges] = useState({ left: false, right: false });
  const show = (id: string) => {
    setActive(id);
    if (id === 'list') setCollapsed(false);
    requestAnimationFrame(() => {
      const card = scroller.current?.querySelector<HTMLElement>(`[data-live-card="${id}"]`);
      if (card && scroller.current && window.matchMedia('(min-width: 901px)').matches) {
        scroller.current.scrollTo({ left: card.offsetLeft - 12, behavior: 'instant' });
      }
    });
  };
  useEffect(() => {
    if (sourceId) {
      const trigger = document.activeElement;
      if (
        trigger instanceof HTMLElement &&
        scroller.current?.querySelector('[data-live-card="conversation"]')?.contains(trigger)
      )
        sourceTrigger.current = trigger;
      show('source');
    } else {
      setActive('conversation');
      setFullscreen(false);
      if (previousSource.current) restoreConversationFocus();
    }
    previousSource.current = sourceId;
  }, [sourceId]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const update = () =>
      setEdges({
        left: element.scrollLeft > 2,
        right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2,
      });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    Array.from(element.children).forEach((child) => observer.observe(child));
    element.addEventListener('scroll', update);
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', update);
    };
  }, [sourceId, collapsed, widths]);
  useEffect(() => {
    if (!fullscreen) {
      if (sourceId) show('source');
      return;
    }
    const dialog = scroller.current?.querySelector<HTMLElement>('[data-live-card="source"]');
    if (!dialog) return;
    // Make the whole surrounding shell inert, not just the cards within this deck.
    // Preserve existing inert state, including the cards managed by React above.
    const suspended: HTMLElement[] = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.inert) {
          sibling.inert = true;
          suspended.push(sibling);
        }
      }
      if (parent === document.body) break;
      branch = parent;
    }
    const focusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length && !element.closest('[inert]'));
    const first = () => (focusable()[0] || dialog).focus({ preventScroll: true });
    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) first();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setFullscreen(false);
      } else if (event.key === 'Tab') {
        event.preventDefault();
        const controls = focusable();
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const index = event.shiftKey
          ? current <= 0
            ? controls.length - 1
            : current - 1
          : (current + 1) % controls.length;
        (controls[index] || dialog).focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', containFocus, true);
    first();
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', containFocus, true);
      for (const element of suspended) element.inert = false;
      requestAnimationFrame(() => {
        if (fullscreenTrigger.current?.isConnected) fullscreenTrigger.current.focus({ preventScroll: true });
        else restoreConversationFocus();
      });
    };
  }, [fullscreen]);
  const close = () => {
    setFullscreen(false);
    closeSource();
    show('conversation');
  };
  return (
    <div className={`live-conversations ${collapsed ? 'live-list-collapsed' : ''}`}>
      <div className="live-deck-toolbar" inert={fullscreen || undefined}>
        <IconButton
          icon={collapsed ? PanelLeftOpen : PanelLeftClose}
          label={collapsed ? '展开会话列表' : '收起会话列表'}
          aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)}
        />
        <div className="live-deck-tabs" aria-label="会话卡片切换">
          <button type="button" aria-pressed={active === 'list'} onClick={() => show('list')}>
            列表
          </button>
          <button type="button" aria-pressed={active === 'conversation'} onClick={() => show('conversation')}>
            对话
          </button>
          {source && (
            <button type="button" aria-pressed={active === 'source'} onClick={() => show('source')}>
              资料来源
            </button>
          )}
        </div>
        <span className="live-deck-caption">
          {source ? '对照资料，继续工作' : '会话与资料，在同一工作区'}
        </span>
        <div className="live-deck-arrows">
          <IconButton
            icon={ArrowLeft}
            label="向左查看卡片"
            disabled={!edges.left}
            onClick={() => scroller.current?.scrollBy({ left: -420, behavior: 'instant' })}
          />
          <IconButton
            icon={ArrowRight}
            label="向右查看卡片"
            disabled={!edges.right}
            onClick={() => scroller.current?.scrollBy({ left: 420, behavior: 'instant' })}
          />
        </div>
      </div>
      <div className="live-deck-scroller" ref={scroller}>
        <LiveCard
          id="list"
          label="会话导航"
          active={active === 'list'}
          width={widths.list}
          min={210}
          max={360}
          onWidth={(width) => setWidths((all) => ({ ...all, list: width }))}
          hidden={collapsed}
          inert={fullscreen}
        >
          {navigation}
        </LiveCard>
        <LiveCard
          id="conversation"
          label="当前会话"
          inert={fullscreen}
          active={active === 'conversation'}
          width={widths.conversation}
          min={420}
          max={1100}
          onWidth={(width) => setWidths((all) => ({ ...all, conversation: width }))}
        >
          {children}
        </LiveCard>
        {source && (
          <LiveCard
            id="source"
            label="资料来源"
            active={active === 'source'}
            width={widths.source}
            min={340}
            max={900}
            onWidth={(width) => setWidths((all) => ({ ...all, source: width }))}
            fullscreen={fullscreen}
          >
            <header className="live-card-heading">
              <strong>资料来源</strong>
              <div className="live-card-actions">
                <IconButton
                  icon={fullscreen ? Minimize2 : Maximize2}
                  label={fullscreen ? '退出来源全屏' : '全屏查看资料来源'}
                  onClick={(event) => {
                    if (!fullscreen) fullscreenTrigger.current = event.currentTarget;
                    setFullscreen(!fullscreen);
                  }}
                />
                <IconButton icon={X} label="关闭资料来源" onClick={close} />
              </div>
            </header>
            <div className="live-source-reader">{source}</div>
          </LiveCard>
        )}
      </div>
    </div>
  );
}

function LiveCard({
  id,
  label,
  active,
  width,
  min,
  max,
  onWidth,
  children,
  hidden,
  fullscreen,
  inert,
}: {
  id: string;
  label: string;
  active: boolean;
  width?: number;
  min: number;
  max: number;
  onWidth: (width: number) => void;
  children: ReactNode;
  hidden?: boolean;
  fullscreen?: boolean;
  inert?: boolean;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const resize = (value: number) => onWidth(Math.max(min, Math.min(max, value)));
  return (
    <section
      className={`live-deck-card live-card-${id} ${active ? 'is-mobile-active' : ''} ${fullscreen ? 'is-fullscreen' : ''}`}
      aria-label={label}
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen || undefined}
      tabIndex={fullscreen ? -1 : undefined}
      inert={inert || undefined}
      data-live-card={id}
      data-custom-width={width ? true : undefined}
      hidden={hidden}
      style={width ? ({ '--live-card-width': `${width}px` } as CSSProperties) : undefined}
    >
      {children}
      <div
        className="live-card-resizer"
        role="separator"
        aria-label={`调整${label}宽度`}
        aria-orientation="vertical"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={width || (id === 'list' ? 240 : id === 'source' ? 460 : 680)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = {
            x: event.clientX,
            width: event.currentTarget.parentElement!.getBoundingClientRect().width,
          };
        }}
        onPointerMove={(event) => {
          if (drag.current) resize(drag.current.width + event.clientX - drag.current.x);
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const current = event.currentTarget.parentElement!.getBoundingClientRect().width;
          resize(
            event.key === 'Home'
              ? min
              : event.key === 'End'
                ? max
                : current + (event.key === 'ArrowRight' ? 24 : -24),
          );
        }}
      >
        <span />
      </div>
    </section>
  );
}
