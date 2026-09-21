import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { resizeBriefingSize, type BriefingLayoutAnchor } from '../briefingLayout';
import type { CardSize } from '../briefing';

type Rect = { x: number; y: number; width: number; height: number };

// Capture the currently painted rectangles, including unfinished animations, before each reflow.
// Retargeting from those rectangles prevents snapping back when another grid boundary is crossed.
export function useBriefingReflow(page: RefObject<HTMLDivElement | null>) {
  const pending = useRef<Map<HTMLElement, Rect> | null>(null);
  const animations = useRef(new Map<HTMLElement, Animation>());
  const rect = (el: HTMLElement): Rect => {
    const box = el.getBoundingClientRect();
    const scroll = page.current?.closest('main');
    return { x: box.left, y: box.top + (scroll?.scrollTop || 0), width: box.width, height: box.height };
  };
  const capture = useCallback(() => {
    pending.current = new Map(
      [
        ...(page.current?.querySelectorAll<HTMLElement>('.briefing-grid > *, .briefing-date-divider') || []),
      ].map((el) => [el, rect(el)]),
    );
  }, [page]);
  useLayoutEffect(() => {
    const before = pending.current;
    if (!before) return;
    pending.current = null;
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [el, old] of before) {
      if (!el.isConnected) continue;
      const next = rect(el);
      if (!next.width || !next.height) continue;
      const dx = old.x - next.x;
      const dy = old.y - next.y;
      if (
        Math.abs(dx) + Math.abs(dy) + Math.abs(old.width - next.width) + Math.abs(old.height - next.height) <
        1
      )
        continue;
      const animation = el.animate(
        [
          {
            transform: `translate(${dx}px, ${dy}px)`,
            width: `${old.width}px`,
            height: `${old.height}px`,
          },
          { transform: 'none', width: `${next.width}px`, height: `${next.height}px` },
        ],
        { duration: 240, easing: 'cubic-bezier(.22,.68,0,1)', fill: 'both' },
      );
      animations.current.set(el, animation);
      animation.finished
        .then(() => {
          if (animations.current.get(el) === animation) {
            animations.current.delete(el);
            animation.cancel();
          }
        })
        .catch(() => {
          /* An interrupted transition is retargeted from its current position. */
        });
    }
  });
  useEffect(
    () => () => {
      for (const animation of animations.current.values()) animation.cancel();
    },
    [],
  );
  return capture;
}

type ResizePosition = { groupId: string; row: number; col: number };
type Preview = { id: string; initial: CardSize; size: CardSize; position: ResizePosition };
type Gesture = Preview & {
  pointerId: number;
  handle: HTMLButtonElement;
  captureTarget: HTMLElement;
  scroller: HTMLElement;
  startX: number;
  startY: number;
  x: number;
  y: number;
  scrollTop: number;
  pitch: number;
  availableColumns: number;
  frame: number;
  moved: boolean;
};
type Options = {
  page: RefObject<HTMLDivElement | null>;
  columns: number;
  unit: number;
  viewKey: string;
  onCommit: (id: string, size: CardSize, position: ResizePosition) => void;
};

export function useBriefingResize(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const layoutKey = `${options.viewKey}/${options.columns}`;
  const [anchors, setAnchors] = useState<{ key: string; groups: Record<string, BriefingLayoutAnchor> }>({
    key: layoutKey,
    groups: {},
  });
  const [announcement, setAnnouncement] = useState('');
  const hint = useRef<HTMLDivElement>(null);
  const capture = useBriefingReflow(options.page);
  const retainPosition = useCallback((current: Pick<Preview, 'id' | 'position'>) => {
    const { viewKey, columns } = latest.current;
    const key = `${viewKey}/${columns}`;
    setAnchors((saved) => ({
      key,
      groups: {
        ...(saved.key === key ? saved.groups : {}),
        [current.position.groupId]: { id: current.id, row: current.position.row, col: current.position.col },
      },
    }));
  }, []);

  const update = useCallback(
    (current: Gesture) => {
      const size = resizeBriefingSize(
        current.initial,
        current.size,
        current.x - current.startX,
        current.y - current.startY + current.scroller.scrollTop - current.scrollTop,
        current.pitch,
        current.availableColumns,
      );
      if (size !== current.size) {
        capture();
        current.size = size;
        setPreview({ id: current.id, initial: current.initial, size, position: current.position });
      }
      if (hint.current) {
        hint.current.style.left = `${Math.max(8, Math.min(innerWidth - 88, current.x + 18))}px`;
        hint.current.style.top = `${Math.max(8, Math.min(innerHeight - 42, current.y + 18))}px`;
      }
    },
    [capture],
  );

  const finish = useCallback(
    (commit: boolean) => {
      const current = gesture.current;
      if (!current) return;
      if (commit) update(current);
      gesture.current = null;
      cancelAnimationFrame(current.frame);
      if (current.captureTarget.hasPointerCapture(current.pointerId))
        current.captureTarget.releasePointerCapture(current.pointerId);
      capture();
      setPreview(null);
      if (commit && current.size !== current.initial) {
        retainPosition(current);
        latest.current.onCommit(current.id, current.size, current.position);
        setAnnouncement(`卡片已调整为 ${current.size}`);
      } else if (!commit) setAnnouncement('已取消尺寸调整');
      current.handle.focus({ preventScroll: true });
    },
    [capture, update, retainPosition],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      event.preventDefault();
      current.x = event.clientX;
      current.y = event.clientY;
      current.moved ||= Math.hypot(current.x - current.startX, current.y - current.startY) > 4;
    };
    const up = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      current.x = event.clientX;
      current.y = event.clientY;
      finish(true);
    };
    const cancelPointer = (event: PointerEvent) => {
      // Touch transfers its implicit capture from the handle to the stable page.
      if (event.type === 'lostpointercapture' && event.target !== gesture.current?.captureTarget) return;
      if (event.pointerId === gesture.current?.pointerId) finish(false);
    };
    const restoreCapture = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      // Dense reflow can move the same keyed card in the DOM during a drag.
      // Reattach capture to its retained handle; pointercancel and blur still cancel.
      if (!current.handle.isConnected) return finish(false);
      try {
        current.handle.setPointerCapture(current.pointerId);
      } catch {
        finish(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      }
    };
    const blur = () => finish(false);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancelPointer);
    document.addEventListener('lostpointercapture', restoreCapture);
    document.addEventListener('keydown', escape, true);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancelPointer);
      document.removeEventListener('lostpointercapture', restoreCapture);
      document.removeEventListener('keydown', escape, true);
      window.removeEventListener('blur', blur);
      if (gesture.current) cancelAnimationFrame(gesture.current.frame);
      gesture.current = null;
    };
  }, [finish]);
  useEffect(() => {
    finish(false);
  }, [options.viewKey, options.columns, options.unit, finish]);

  const start = (
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
    size: CardSize,
    position: ResizePosition,
  ) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current) return;
    const scroller = options.page.current?.closest('main');
    if (!scroller) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    handle.focus({ preventScroll: true });
    // Dense packing moves card nodes in DOM order. Capture on the page so a
    // moving handle cannot cancel an active resize halfway through the gesture.
    const captureTarget = options.page.current!;
    captureTarget.setPointerCapture(event.pointerId);
    const current: Gesture = {
      id,
      size,
      initial: size,
      position,
      handle,
      captureTarget,
      scroller,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      scrollTop: scroller.scrollTop,
      pitch: options.unit + 10,
      // Growing past the right edge must not relocate the active card.
      availableColumns: options.columns - position.col,
      frame: 0,
      moved: false,
    };
    gesture.current = current;
    setPreview({ id, initial: size, size, position });
    const tick = () => {
      if (gesture.current !== current) return;
      if (current.moved) {
        const bounds = scroller.getBoundingClientRect();
        const top = Math.max(bounds.top, 0) + 46;
        const bottom = Math.min(bounds.bottom, innerHeight) - 46;
        const speed =
          current.y < top
            ? -Math.min(14, (top - current.y) / 3)
            : current.y > bottom
              ? Math.min(14, (current.y - bottom) / 3)
              : 0;
        scroller.scrollTop += speed;
      }
      update(current);
      current.frame = requestAnimationFrame(tick);
    };
    current.frame = requestAnimationFrame(tick);
  };

  const keyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    id: string,
    size: CardSize,
    position: ResizePosition,
  ) => {
    if (gesture.current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const width =
      options.columns - position.col === 1
        ? 1
        : event.key === 'ArrowLeft'
          ? 1
          : event.key === 'ArrowRight'
            ? 2
            : Number(size[0]);
    const height = event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? 2 : Number(size[2]);
    const next = `${width}×${height}` as CardSize;
    if (next === size) return;
    capture();
    retainPosition({ id, position });
    latest.current.onCommit(id, next, position);
    setAnnouncement(`卡片已调整为 ${next}`);
  };
  const layoutAnchor = (groupId: string): BriefingLayoutAnchor | undefined =>
    preview?.position.groupId === groupId && preview.size !== preview.initial
      ? { id: preview.id, row: preview.position.row, col: preview.position.col }
      : anchors.key === layoutKey
        ? anchors.groups[groupId]
        : undefined;
  const clearAnchors = () => setAnchors({ key: layoutKey, groups: {} });
  return {
    preview,
    hint,
    announcement,
    start,
    keyDown,
    layoutAnchor,
    clearAnchors,
    cancel: () => finish(false),
  };
}

export type BriefingResize = ReturnType<typeof useBriefingResize>;
export function BriefingResizeHandle({
  id,
  title,
  size,
  resize,
  position,
  disabled = false,
}: {
  id: string;
  title: string;
  size: CardSize;
  resize: BriefingResize;
  position: ResizePosition;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="briefing-resize-handle"
      aria-label={`调整 ${title} 大小，当前 ${size}`}
      aria-describedby="briefing-resize-help"
      title="拖动调整大小；方向键也可调整"
      onPointerDown={(event) => resize.start(event, id, size, position)}
      onKeyDown={(event) => resize.keyDown(event, id, size, position)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <svg viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <path d="M34.08 20.04a23.5 23.5 0 0 1-14.04 14.04" />
      </svg>
    </button>
  );
}
