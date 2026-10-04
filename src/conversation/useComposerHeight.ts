import { useLayoutEffect, type RefObject } from 'react';

/** Measure away from the visible input so its numeric height can keep transitioning. */
export function useComposerHeight(
  ref: RefObject<HTMLTextAreaElement | null>,
  text: string,
  expanded: boolean,
  fromBriefing: boolean,
) {
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    let width = node.getBoundingClientRect().width;
    const resize = () => {
      if (!node.offsetWidth) return;
      let height = 54;
      if (!fromBriefing || expanded) {
        const probe = node.cloneNode(false) as HTMLTextAreaElement;
        probe.removeAttribute('id');
        probe.removeAttribute('name');
        probe.removeAttribute('aria-label');
        probe.setAttribute('aria-hidden', 'true');
        probe.tabIndex = -1;
        probe.value = node.value;
        Object.assign(probe.style, {
          position: 'fixed',
          left: '-10000px',
          top: '0',
          width: `${width}px`,
          height: 'auto',
          visibility: 'hidden',
          transition: 'none',
        });
        node.parentElement!.append(probe);
        height = Math.min(160, Math.max(fromBriefing ? 68 : 70, probe.scrollHeight));
        probe.remove();
      }
      const target = `${height}px`;
      if (node.style.height !== target) node.style.height = target;
    };
    resize();
    const observer = new ResizeObserver(() => {
      const nextWidth = node.getBoundingClientRect().width;
      // Height animation also fires this observer; only remeasure when text wraps differently.
      if (!nextWidth || nextWidth === width) return;
      width = nextWidth;
      resize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, text, expanded, fromBriefing]);
}
