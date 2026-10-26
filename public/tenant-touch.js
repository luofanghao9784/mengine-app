// Touch lifecycle adapter: React owns continuous movement and release snapping.
// Keep native list scrolling for the entire gesture; only a NEW boundary gesture
// can move the sheet. Do not duplicate React state or change desktop wheel input.
(function () {
  'use strict';
  var gesture = null;
  var suppressClick = null;
  function canScroll(target, shell, delta) {
    for (var el = target; el && el !== shell; el = el.parentElement) {
      var style = getComputedStyle(el);
      if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if (delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0)
          return true;
      }
    }
    return false;
  }
  document.addEventListener('touchstart', function (event) {
    finish({ type: 'touchcancel' });
    suppressClick = null;
    if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
    var target = event.target;
    var shell = target.closest('.shell');
    if (!shell || !target.closest('.deck') ||
        !['home', 'data', 'knowledge', 'experience'].includes(shell.dataset.place) ||
        document.querySelector('[role="dialog"][aria-modal="true"], .palette') ||
        target.closest('input,textarea,select,[contenteditable], [role="slider"],canvas,video')) return;
    var point = event.touches[0];
    gesture = { target: target, shell: shell, id: point.identifier,
      x: point.clientX, y: point.clientY, mode: null, moved: false, lastY: point.clientY };
  }, { passive: true });
  document.addEventListener('touchmove', function (event) {
    var g = gesture;
    if (!g) return;
    if (event.touches.length !== 1 || !g.target.isConnected || !event.cancelable) {
      finish({ type: 'touchcancel' });
      return;
    }
    var point = event.touches[0];
    if (point.identifier !== g.id) return;
    var dx = point.clientX - g.x, dy = g.y - point.clientY;
    if (!g.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      var selection = window.getSelection();
      if (Math.abs(dx) >= Math.abs(dy) || (selection && !selection.isCollapsed) ||
          canScroll(g.target, g.shell, dy)) {
        g.mode = 'native';
        return;
      }
      g.mode = 'sheet';
    }
    if (g.mode !== 'sheet') return;
    var delta = g.lastY - point.clientY;
    var update = new CustomEvent('tenant-sheet-touch', {
      detail: { phase: 'move', delta: delta }, bubbles: false, cancelable: true
    });
    if (!g.shell.dispatchEvent(update)) {
      event.preventDefault();
      g.moved = true;
      g.lastY = point.clientY;
    }
  }, { passive: false });
  function finish(event) {
    if (gesture && gesture.moved)
      gesture.shell.dispatchEvent(new CustomEvent('tenant-sheet-touch', { detail: { phase: 'end' } }));
    if (gesture && gesture.moved && event.type === 'touchend')
      suppressClick = { shell: gesture.shell, until: performance.now() + 700 };
    gesture = null;
  }
  document.addEventListener('touchend', finish, { passive: true });
  document.addEventListener('touchcancel', finish, { passive: true });
  document.addEventListener('click', function (event) {
    if (suppressClick && performance.now() < suppressClick.until &&
        event.target instanceof Node && suppressClick.shell.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    suppressClick = null;
  }, true);
})();
