/**
 * 星图标注的防遮挡排位：按重要程度从高到低摆放，每个标注依次试点的下方、上方、右侧、左侧，
 * 四处都会压住已摆好的标注就先只留光点。相机一直在缓慢转动，所以带“迟滞”：
 * 已显示的标注被挡住一小段时间后才隐藏，新标注连续几帧都有空位才出现，避免忽隐忽现。
 */
export type Side = 'below' | 'above' | 'right' | 'left';
export interface LabelBox {
  key: string;
  /** 光点在画布上的位置。 */
  x: number;
  y: number;
  /** 标注文字的尺寸。 */
  w: number;
  h: number;
  /** 越大越先摆；不小于 FORCED 的（选中、悬停）总是显示。 */
  rank: number;
}
export interface Placement {
  left: number;
  top: number;
  side: Side;
}
export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const FORCED = 1e6;
const SIDES: Side[] = ['below', 'above', 'right', 'left'];
const GAP = 9, // 光点到文字的距离
  PAD = 6; // 两条标注之间至少留的空隙
/** 与当前焦点相连的优先级起点：它们在密度上限内排在前面。 */
export const LINKED = 1e4;

export function placeAt(side: Side, x: number, y: number, w: number, h: number): Placement {
  if (side === 'below') return { side, left: x - w / 2, top: y + GAP };
  if (side === 'above') return { side, left: x - w / 2, top: y - GAP - h };
  if (side === 'right') return { side, left: x + GAP + 2, top: y - h / 2 };
  return { side, left: x - GAP - 2 - w, top: y - h / 2 };
}

type Rect = { l: number; t: number; r: number; b: number };
const hits = (a: Rect, list: Rect[]) =>
  list.some((b) => a.l < b.r + PAD && b.l < a.r + PAD && a.t < b.b + PAD && b.t < a.b + PAD);

export class LabelLayout {
  private shown = new Map<string, { side: Side; blocked: number }>();
  private waiting = new Map<string, number>();
  private hideAfter: number;
  private showAfter: number;
  /** hideAfter：被挡住多少帧后隐藏；showAfter：连续多少帧有空位才出现。 */
  constructor(hideAfter = 14, showAfter = 5) {
    this.hideAfter = hideAfter;
    this.showAfter = showAfter;
  }

  /** limit：除选中、悬停外最多显示几个标注（与焦点相连的优先），控制整体密度。 */
  place(items: LabelBox[], bounds: Bounds, limit = Infinity): Map<string, Placement | null> {
    const out = new Map<string, Placement | null>();
    const taken: Rect[] = [];
    let plain = 0;
    // 已显示的略微加权，同等重要时不和新来的抢位置。
    const order = [...items].sort(
      (a, b) => b.rank + (this.shown.has(b.key) ? 0.5 : 0) - (a.rank + (this.shown.has(a.key) ? 0.5 : 0)),
    );
    for (const item of order) {
      const prior = this.shown.get(item.key);
      const sides = prior ? [prior.side, ...SIDES.filter((s) => s !== prior.side)] : SIDES;
      let fit: Placement | null = null;
      const capped = item.rank < FORCED && plain >= limit;
      for (const side of capped ? [] : sides) {
        const p = placeAt(side, item.x, item.y, item.w, item.h);
        const rect = { l: p.left, t: p.top, r: p.left + item.w, b: p.top + item.h };
        const inside =
          rect.l >= bounds.left && rect.r <= bounds.right && rect.t >= bounds.top && rect.b <= bounds.bottom;
        if (inside && !hits(rect, taken)) {
          fit = p;
          break;
        }
      }
      const forced = item.rank >= FORCED;
      if (!fit && (forced || prior)) {
        // 选中、悬停的必须显示；已显示的在宽限期内留在原侧，之后再让开。
        const blocked = (prior?.blocked ?? 0) + 1;
        if (forced || blocked < this.hideAfter) {
          fit = placeAt(prior?.side ?? 'below', item.x, item.y, item.w, item.h);
          this.shown.set(item.key, { side: fit.side, blocked: forced ? 0 : blocked });
          taken.push({ l: fit.left, t: fit.top, r: fit.left + item.w, b: fit.top + item.h });
          out.set(item.key, fit);
          if (item.rank < FORCED) plain++;
          continue;
        }
        this.shown.delete(item.key);
        this.waiting.delete(item.key);
        out.set(item.key, null);
        continue;
      }
      if (!fit) {
        this.waiting.delete(item.key);
        out.set(item.key, null);
        continue;
      }
      // 有空位：占住它（即使还在等待出现），免得后面的标注抢走。
      taken.push({ l: fit.left, t: fit.top, r: fit.left + item.w, b: fit.top + item.h });
      if (item.rank < FORCED) plain++;
      if (prior || forced) {
        this.shown.set(item.key, { side: fit.side, blocked: 0 });
        out.set(item.key, fit);
        continue;
      }
      const frames = (this.waiting.get(item.key) ?? 0) + 1;
      if (frames >= this.showAfter) {
        this.waiting.delete(item.key);
        this.shown.set(item.key, { side: fit.side, blocked: 0 });
        out.set(item.key, fit);
      } else {
        this.waiting.set(item.key, frames);
        out.set(item.key, null);
      }
    }
    // 这一帧没出现的标注不再记着。
    const present = new Set(items.map((x) => x.key));
    for (const key of this.shown.keys()) if (!present.has(key)) this.shown.delete(key);
    for (const key of this.waiting.keys()) if (!present.has(key)) this.waiting.delete(key);
    return out;
  }

  reset() {
    this.shown.clear();
    this.waiting.clear();
  }
}
