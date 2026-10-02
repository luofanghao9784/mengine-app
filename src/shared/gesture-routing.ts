/** Keep one wheel burst on its initial axis, including its inertial tail. */
export function wheelGestureAxis() {
  let last = -Infinity;
  let axis: 'x' | 'y' | null = null;
  let travelX = 0,
    travelY = 0;
  return (event: WheelEvent) => {
    const now = performance.now();
    if (now - last > 240) {
      axis = null;
      travelX = travelY = 0;
    }
    last = now;
    if (event.ctrlKey || event.metaKey || event.altKey) return null;
    const x = Math.abs(event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX);
    const y = event.shiftKey ? 0 : Math.abs(event.deltaY);
    if (!axis) {
      // Trackpads often begin with a tiny off-axis sample. Wait for actual travel
      // before locking so that noise cannot block a deliberate horizontal swipe.
      travelX += x;
      travelY += y;
      if (travelX >= 6 && travelX > travelY * 1.25) axis = 'x';
      else if (travelY >= 6 && travelY > travelX * 1.25) axis = 'y';
    }
    return axis;
  };
}

/** An inner reader/table owns its gesture even at its edge; do not move its parent deck/tab. */
export function hasNestedScroll(target: Element, boundary: Element, axis: 'x' | 'y') {
  for (
    let node: Element | null = target;
    node && node !== boundary && boundary.contains(node);
    node = node.parentElement
  ) {
    const style = getComputedStyle(node);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const extent = axis === 'x' ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
    if (extent > 1 && /(auto|scroll)/.test(overflow)) return true;
  }
  return false;
}
