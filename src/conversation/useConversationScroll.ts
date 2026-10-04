import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Follow new content unless the reader has deliberately left the bottom or is interacting. */
export function useConversationScroll(key: string, enabled: boolean) {
  const [element, ref] = useState<HTMLDivElement | null>(null);
  const following = useRef(true);
  const schedule = useRef<() => void>(() => {});
  const followLatest = useCallback(() => {
    following.current = true;
    schedule.current();
  }, []);
  useLayoutEffect(() => {
    following.current = true;
    if (!element || !enabled) return;
    let frame = 0,
      pointer = false,
      gestureUntil = 0;
    const nearBottom = () => element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    const interacting = () => {
      const selection = document.getSelection();
      const selecting =
        selection &&
        !selection.isCollapsed &&
        (element.contains(selection.anchorNode) || element.contains(selection.focusNode));
      const active = document.activeElement;
      return (
        pointer ||
        selecting ||
        (active &&
          element.contains(active) &&
          active.matches('button,a,input,textarea,select,summary,[role="button"]'))
      );
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (following.current && !interacting()) {
          gestureUntil = 0;
          element.scrollTop = element.scrollHeight;
        }
      });
    };
    schedule.current = update;
    // Only input gestures can suspend following. Layout/stream-induced scroll events cannot.
    const intent = () => {
      gestureUntil = performance.now() + 1200;
    };
    const wheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      intent();
      if (event.deltaY < 0) following.current = false;
    };
    const keydown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        intent();
        if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) following.current = false;
      }
    };
    const down = (event: PointerEvent) => {
      pointer = true;
      if (element.contains(event.target as Node)) intent();
    };
    const up = () => {
      pointer = false;
      update();
    };
    const scroll = () => {
      if (nearBottom()) {
        following.current = true;
        gestureUntil = 0;
      } else if (pointer || performance.now() < gestureUntil) following.current = false;
    };
    const children = new Set<Element>();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const observe = () => {
      for (const child of children)
        if (child.parentElement !== element) {
          resize.unobserve(child);
          children.delete(child);
        }
      for (const child of element.children)
        if (!children.has(child)) {
          children.add(child);
          resize.observe(child);
        }
      update();
    };
    const changes = new MutationObserver(observe);
    changes.observe(element, { childList: true, subtree: true, characterData: true });
    element.addEventListener('wheel', wheel, { passive: true });
    element.addEventListener('touchmove', intent, { passive: true });
    element.addEventListener('keydown', keydown);
    element.addEventListener('scroll', scroll, { passive: true });
    element.addEventListener('focusout', update);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('selectionchange', update);
    observe();
    return () => {
      schedule.current = () => {};
      cancelAnimationFrame(frame);
      changes.disconnect();
      resize.disconnect();
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchmove', intent);
      element.removeEventListener('keydown', keydown);
      element.removeEventListener('scroll', scroll);
      element.removeEventListener('focusout', update);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('selectionchange', update);
    };
  }, [element, key, enabled]);
  return { ref, element, followLatest };
}
