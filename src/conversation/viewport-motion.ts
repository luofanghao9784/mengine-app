import {
  captureDetailVisual,
  captureDraftVisual,
  type BriefingVisual,
} from '../components/conversationMotion';

type Origin = {
  tenant: string;
  target: 'composer' | 'briefing';
  visual: BriefingVisual;
  scroll: number;
  at: number;
};
let origin: Origin | undefined;
// A transient visual handoff only; never persisted or used as the reader's data source.
export function prepareViewportMotion(
  tenant: string,
  element: HTMLElement,
  target: Origin['target'],
  scroll = 0,
) {
  origin = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? undefined
    : {
        tenant,
        target,
        scroll,
        at: Date.now(),
        visual: target === 'composer' ? captureDraftVisual(element) : captureDetailVisual(element),
      };
}
export function takeViewportMotion(tenant: string) {
  const current = origin;
  origin = undefined;
  return current?.tenant === tenant && Date.now() - current.at < 8000 ? current : undefined;
}
