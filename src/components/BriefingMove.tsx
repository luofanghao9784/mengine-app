import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  saveBriefingLayout,
  type BriefingLayoutAnchor,
  type BriefingSavedLayout,
  type Placement,
} from '../briefingLayout';
import type { CardSize } from '../briefing';
import { useBriefingReflow } from './BriefingResize';

export type MovePreview = BriefingLayoutAnchor & {
  groupId: string;
  size: CardSize;
  baseline: BriefingSavedLayout;
  pointer: boolean;
};
type Gesture = MovePreview & {
  kind: 'mouse' | 'touch' | 'keyboard';
  startRow: number;
  startCol: number;
  viewportWidth: number;
  viewportHeight: number;
  maxRow: number;
  pointerId?: number;
  touchId?: number;
  surface: HTMLButtonElement;
  captureTarget: HTMLElement;
  scroller: HTMLElement;
  x: number;
  y: number;
  startX: number;
  startY: number;
  scrollTop: number;
  pitch: number;
  offsetX: number;
  offsetY: number;
  active: boolean;
  frame: number;
  ghost: HTMLElement | null;
  layer: HTMLElement | null;
};
type Options = {
  page: RefObject<HTMLDivElement | null>;
  columns: number;
  unit: number;
  viewKey: string;
  blocked: boolean;
  placements: (groupId: string) => Placement[];
  manual: (groupId: string) => string[];
  onCommit: (preview: MovePreview) => void;
  onStart: () => void;
  onTouchHold: () => void;
};
const previewOf = (g: Gesture): MovePreview => ({
  id: g.id,
  groupId: g.groupId,
  row: g.row,
  col: g.col,
  size: g.size,
  baseline: g.baseline,
  pointer: g.pointer,
});

export function useBriefingMove(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const pendingTouch = useRef<{
    id: number;
    x: number;
    y: number;
    scrollTop: number;
    surface: HTMLButtonElement;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const capture = useBriefingReflow(options.page);
  const suppressUntil = useRef(0);
  const clearTouch = useCallback(() => {
    if (pendingTouch.current) clearTimeout(pendingTouch.current.timer);
    pendingTouch.current = null;
  }, []);
  const blocked = () =>
    latest.current.blocked ||
    (!!latest.current.page.current?.dataset.refreshPhase &&
      latest.current.page.current.dataset.refreshPhase !== 'idle') ||
    !!latest.current.page.current?.closest('[inert]') ||
    !!document.querySelector('dialog[open], [data-anchored-popover]');

  const finish = useCallback(
    (commit: boolean) => {
      clearTouch();
      const g = gesture.current;
      if (!g) return;
      commit = commit && innerWidth === g.viewportWidth && innerHeight === g.viewportHeight;
      gesture.current = null;
      cancelAnimationFrame(g.frame);
      g.layer?.remove();
      if (g.pointerId !== undefined && g.captureTarget.hasPointerCapture(g.pointerId))
        g.captureTarget.releasePointerCapture(g.pointerId);
      if (!g.active) return; // A normal short click keeps native focus and click behavior.
      capture();
      setPreview(null);
      if (g.kind !== 'keyboard') suppressUntil.current = performance.now() + 500;
      if (commit && (g.row !== g.startRow || g.col !== g.startCol)) {
        latest.current.onCommit(previewOf(g));
        setAnnouncement('位置已保存，可撤销本次调整');
      } else if (!commit) setAnnouncement('已取消移动');
      requestAnimationFrame(() => {
        if (g.surface.isConnected && !g.surface.closest('[inert]')) g.surface.focus({ preventScroll: true });
      });
    },
    [capture, clearTouch],
  );

  const activate = useCallback(
    (g: Gesture) => {
      if (g.active) return;
      g.active = true;
      latest.current.onStart();
      if (g.kind === 'touch') latest.current.onTouchHold();
      if (g.kind === 'mouse' && g.pointerId !== undefined) g.captureTarget.setPointerCapture(g.pointerId);
      const card = g.surface.closest<HTMLElement>('.briefing-card')!;
      const box = card.getBoundingClientRect();
      g.ghost = card.cloneNode(true) as HTMLElement;
      g.ghost.classList.add('briefing-move-ghost');
      g.ghost.classList.remove('menu-open');
      g.ghost.removeAttribute('id');
      g.ghost.removeAttribute('data-card-id');
      g.ghost.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
      g.ghost.setAttribute('aria-hidden', 'true');
      g.ghost.inert = true;
      Object.assign(g.ghost.style, { width: `${box.width}px`, height: `${box.height}px`, gridArea: 'auto' });
      const styles = getComputedStyle(card);
      for (const name of ['--briefing-ink', '--briefing-muted', '--briefing-line'])
        g.ghost.style.setProperty(name, styles.getPropertyValue(name));
      g.layer = document.createElement('div');
      g.layer.className = 'briefing-grid briefing-drag-layer';
      g.layer.setAttribute('aria-hidden', 'true');
      g.layer.append(g.ghost);
      document.body.append(g.layer);
      capture();
      setPreview(previewOf(g));
      setAnnouncement(
        g.kind === 'touch'
          ? '已拿起卡片，可直接拖动；松手放下，完成退出编辑'
          : '正在移动卡片，松手保存，Esc 取消',
      );
    },
    [capture],
  );

  const update = useCallback(
    (g: Gesture) => {
      const dx = g.x - g.startX,
        dy = g.y - g.startY + g.scroller.scrollTop - g.scrollTop;
      if (!g.active) {
        if (g.kind !== 'mouse' || Math.hypot(dx, dy) < 6) return;
        activate(g);
      }
      if (g.ghost) {
        g.ghost.style.left = `${g.x - g.offsetX}px`;
        g.ghost.style.top = `${g.y - g.offsetY}px`;
      }
      const snap = (value: number, current: number) =>
        Math.abs(value - current) > 0.6 ? Math.round(value) : current;
      const col = Math.max(
        0,
        Math.min(latest.current.columns - Number(g.size[0]), snap(g.startCol + dx / g.pitch, g.col)),
      );
      const row = Math.max(0, Math.min(g.maxRow, snap(g.startRow + dy / g.pitch, g.row)));
      if (col === g.col && row === g.row) return;
      capture();
      g.col = col;
      g.row = row;
      setPreview(previewOf(g));
    },
    [capture, activate],
  );

  const begin = useCallback(
    (surface: HTMLButtonElement, id: string, groupId: string, kind: Gesture['kind']): Gesture | null => {
      if (gesture.current || blocked() || !surface.isConnected) return null;
      const placements = latest.current.placements(groupId);
      const p = placements.find((p) => p.entry.card.id === id);
      const page = latest.current.page.current,
        scroller = page?.closest('main');
      if (!p || !page || !scroller) return null;
      const g: Gesture = {
        id,
        groupId,
        row: p.row,
        col: p.col,
        startRow: p.row,
        startCol: p.col,
        size: p.size,
        baseline: saveBriefingLayout(placements, latest.current.columns, latest.current.manual(groupId)),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pointer: kind !== 'keyboard',
        kind,
        maxRow: Math.max(...placements.map((p) => p.row + p.height)) - 1,
        surface,
        captureTarget: page,
        scroller,
        x: 0,
        y: 0,
        startX: 0,
        startY: 0,
        offsetX: 0,
        offsetY: 0,
        scrollTop: scroller.scrollTop,
        pitch: latest.current.unit + 10,
        active: kind === 'keyboard',
        frame: 0,
        ghost: null,
        layer: null,
      };
      gesture.current = g;
      return g;
    },
    [],
  );
  const track = useCallback(
    (g: Gesture, x: number, y: number) => {
      const box = g.surface.closest('.briefing-card')!.getBoundingClientRect();
      Object.assign(g, { x, y, startX: x, startY: y, offsetX: x - box.left, offsetY: y - box.top });
      const tick = () => {
        if (gesture.current !== g) return;
        if (g.active) {
          const bounds = g.scroller.getBoundingClientRect();
          const top = Math.max(0, bounds.top) + 46,
            bottom = Math.min(innerHeight, bounds.bottom) - 46;
          const speed =
            g.y < top ? -Math.min(14, (top - g.y) / 3) : g.y > bottom ? Math.min(14, (g.y - bottom) / 3) : 0;
          if ((speed < 0 && g.row > 0) || (speed > 0 && g.row < g.maxRow)) g.scroller.scrollTop += speed;
          update(g);
        }
        g.frame = requestAnimationFrame(tick);
      };
      g.frame = requestAnimationFrame(tick);
    },
    [update],
  );

  useEffect(() => {
    const page = options.page.current;
    if (!page) return;
    const move = (e: PointerEvent) => {
      // Browsers can defer touchmove until native pan slop is crossed. Pointer
      // movement arrives sooner, so even a small swipe cancels the hold timer.
      const candidate = pendingTouch.current;
      if (
        e.pointerType === 'touch' &&
        candidate &&
        Math.hypot(e.clientX - candidate.x, e.clientY - candidate.y) > 8
      )
        clearTouch();
      const g = gesture.current;
      if (g?.kind !== 'mouse' || g.pointerId !== e.pointerId) return;
      g.x = e.clientX;
      g.y = e.clientY;
      update(g);
      if (g.active) e.preventDefault();
    };
    const up = (e: PointerEvent) => {
      const g = gesture.current;
      if (g?.kind !== 'mouse' || g.pointerId !== e.pointerId) return;
      g.x = e.clientX;
      g.y = e.clientY;
      update(g);
      finish(true);
    };
    const cancelPointer = (e: PointerEvent) => {
      if (e.type === 'pointercancel') clearTouch();
      const g = gesture.current;
      if (g?.kind !== 'mouse' || g.pointerId !== e.pointerId) return;
      if (e.type === 'lostpointercapture' && e.target !== g.captureTarget) return;
      finish(false);
    };
    const touchStart = (e: TouchEvent) => {
      clearTouch();
      if (e.touches.length !== 1) {
        if (gesture.current?.kind === 'touch') finish(false);
        return;
      }
      if (blocked() || gesture.current || !(e.target instanceof Element)) return;
      const surface = e.target.closest<HTMLButtonElement>('.briefing-card-main');
      if (!surface || !page.contains(surface)) return;
      const t = e.touches[0],
        scroller = page.closest('main')!;
      const candidate = {
        id: t.identifier,
        x: t.clientX,
        y: t.clientY,
        scrollTop: scroller.scrollTop,
        surface,
        timer: setTimeout(() => {
          if (
            pendingTouch.current !== candidate ||
            blocked() ||
            !surface.isConnected ||
            Math.abs(scroller.scrollTop - candidate.scrollTop) > 1
          ) {
            clearTouch();
            return;
          }
          pendingTouch.current = null;
          const card = surface.closest<HTMLElement>('[data-card-id]')!;
          const groupId = card.closest<HTMLElement>('[data-group-id]')!.dataset.groupId!;
          const g = begin(surface, card.dataset.cardId!, groupId, 'touch');
          if (!g) return;
          g.touchId = candidate.id;
          track(g, candidate.x, candidate.y);
          activate(g);
          update(g);
          window.getSelection()?.removeAllRanges();
        }, 500),
      };
      pendingTouch.current = candidate;
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        clearTouch();
        if (gesture.current?.kind === 'touch') finish(false);
        return;
      }
      const t = e.touches[0],
        candidate = pendingTouch.current;
      // Once a contact starts scrolling, pausing that same contact never rearms it.
      if (candidate?.id === t.identifier && Math.hypot(t.clientX - candidate.x, t.clientY - candidate.y) > 8)
        clearTouch();
      const g = gesture.current;
      if (g?.kind !== 'touch' || g.touchId !== t.identifier) return;
      if (!e.cancelable) {
        finish(false);
        return;
      }
      e.preventDefault();
      g.x = t.clientX;
      g.y = t.clientY;
      update(g);
    };
    const touchEnd = (e: TouchEvent) => {
      clearTouch();
      const g = gesture.current;
      if (g?.kind !== 'touch') return;
      const t = [...e.changedTouches].find((t) => t.identifier === g.touchId);
      if (t) {
        g.x = t.clientX;
        g.y = t.clientY;
        update(g);
        finish(true);
      }
    };
    const touchCancel = () => {
      clearTouch();
      if (gesture.current?.kind === 'touch') finish(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (gesture.current || pendingTouch.current)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        finish(false);
      }
    };
    const freshContact = () => {
      if (!gesture.current) suppressUntil.current = 0;
    };
    const click = (e: MouseEvent) => {
      if (e.detail && performance.now() < suppressUntil.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const contextMenu = (e: MouseEvent) => {
      if (pendingTouch.current || gesture.current?.kind === 'touch') e.preventDefault();
    };
    const dragStart = (e: DragEvent) => {
      if ((e.target as Element).closest('.briefing-card-main')) e.preventDefault();
    };
    const cancel = () => finish(false);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('lostpointercapture', cancelPointer);
    document.addEventListener('keydown', key, true);
    page.addEventListener('pointerdown', freshContact, true);
    page.addEventListener('click', click, true);
    page.addEventListener('contextmenu', contextMenu);
    page.addEventListener('dragstart', dragStart);
    page.addEventListener('touchstart', touchStart, { passive: true });
    page.addEventListener('touchmove', touchMove, { passive: false });
    page.addEventListener('touchend', touchEnd);
    page.addEventListener('touchcancel', touchCancel);
    page.closest('main')?.addEventListener('scroll', clearTouch, { passive: true });
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', cancel);
    return () => {
      clearTouch();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancelPointer);
      document.removeEventListener('lostpointercapture', cancelPointer);
      document.removeEventListener('keydown', key, true);
      page.removeEventListener('pointerdown', freshContact, true);
      page.removeEventListener('click', click, true);
      page.removeEventListener('contextmenu', contextMenu);
      page.removeEventListener('dragstart', dragStart);
      page.removeEventListener('touchstart', touchStart);
      page.removeEventListener('touchmove', touchMove);
      page.removeEventListener('touchend', touchEnd);
      page.removeEventListener('touchcancel', touchCancel);
      page.closest('main')?.removeEventListener('scroll', clearTouch);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', cancel);
      const g = gesture.current;
      if (g) {
        cancelAnimationFrame(g.frame);
        g.layer?.remove();
      }
      gesture.current = null;
    };
  }, [options.page, finish, update, activate, begin, track, clearTouch]);
  useEffect(() => {
    finish(false);
  }, [options.columns, options.unit, options.viewKey, finish]);
  useEffect(() => {
    if (options.blocked) finish(false);
  }, [options.blocked, finish]);

  const start = (e: ReactPointerEvent<HTMLButtonElement>, id: string, groupId: string) => {
    if (e.pointerType === 'touch' || e.button !== 0 || !e.isPrimary) return;
    const g = begin(e.currentTarget, id, groupId, 'mouse');
    if (!g) return;
    // No capture or preventDefault until intent is a drag: short clicks still open.
    g.pointerId = e.pointerId;
    track(g, e.clientX, e.clientY);
  };
  const startKeyboard = (surface: HTMLButtonElement, id: string, groupId: string) => {
    const g = begin(surface, id, groupId, 'keyboard');
    if (!g) return;
    latest.current.onStart();
    setPreview(previewOf(g));
    surface.focus({ preventScroll: true });
    setAnnouncement('已拿起卡片，方向键移动，回车放下，Esc 取消');
  };
  const keyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
    const g = gesture.current;
    if (!g || g.id !== id || g.kind !== 'keyboard') return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      finish(true);
      return;
    }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    e.stopPropagation();
    g.col = Math.max(
      0,
      Math.min(
        latest.current.columns - Number(g.size[0]),
        g.col + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0),
      ),
    );
    g.row = Math.max(
      0,
      Math.min(g.maxRow, g.row + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0)),
    );
    capture();
    setPreview(previewOf(g));
    setAnnouncement(`第 ${g.row + 1} 行，第 ${g.col + 1} 列，回车放下`);
    requestAnimationFrame(() => g.surface.focus({ preventScroll: true }));
  };
  return { preview, announcement, start, keyDown, startKeyboard, cancel: () => finish(false), capture };
}
export type BriefingMove = ReturnType<typeof useBriefingMove>;

export function useBriefingEdit(_page: RefObject<HTMLDivElement | null>, viewKey: string, blocked: boolean) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setEditing(false);
  }, [viewKey, blocked]);
  useEffect(() => {
    const blur = () => setEditing(false);
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, []);
  return { editing, setEditing };
}
