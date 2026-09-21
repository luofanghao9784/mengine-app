import { useEffect } from 'react';

/** Track each surface's active thumb and top edge without changing its layout or scroll position. */
export function useAutoHideScrollbars() {
  useEffect(() => {
    const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
    const onScroll = (event: Event) => {
      const target = event.target === document ? document.scrollingElement : event.target;
      if (!(target instanceof HTMLElement)) return;
      target.toggleAttribute('data-scrolled-start', target.scrollTop > 1);
      clearTimeout(timers.get(target));
      target.setAttribute('data-scrolling', '');
      timers.set(
        target,
        setTimeout(() => {
          target.removeAttribute('data-scrolling');
          timers.delete(target);
        }, 700),
      );
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      timers.forEach((timer, target) => {
        clearTimeout(timer);
        target.removeAttribute('data-scrolling');
      });
    };
  }, []);
}
