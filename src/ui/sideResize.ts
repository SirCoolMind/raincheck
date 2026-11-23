// Desktop side panel width: drag the right edge, arrow keys on the focused edge, double-click to reset.
// Width lives in the --side-w custom property on <html>; it is remembered per browser (best effort).
// The map sits full-width UNDER the panel, so resizing never resizes the map canvas (that caused
// flicker): the callback just gets the new width and how far it moved, to pan/pad the map.
const KEY = 'rc.sideW';
export const SIDE_DEFAULT = 400;
export const SIDE_MIN = 320;
const STEP = 16;

const maxWidth = () => Math.max(SIDE_MIN, Math.min(760, Math.round(window.innerWidth * 0.6)));
const clamp = (w: number) => Math.round(Math.min(maxWidth(), Math.max(SIDE_MIN, w)));

function load(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isFinite(v) && v > 0 ? v : SIDE_DEFAULT;
  } catch {
    return SIDE_DEFAULT;
  }
}
function save(w: number): void {
  try {
    if (w === SIDE_DEFAULT) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(w));
  } catch {
    /* private mode etc. — width just isn't remembered */
  }
}

/** Current panel width in px (desktop layout). */
export function sideWidth(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--side-w'));
  return Number.isFinite(v) && v > 0 ? v : SIDE_DEFAULT;
}

export function mountSideResize(sheet: HTMLElement, onResize: (width: number, delta: number) => void): void {
  const root = document.documentElement;
  const bar = document.createElement('div');
  bar.className = 'side-resizer';
  bar.setAttribute('role', 'separator');
  bar.setAttribute('aria-orientation', 'vertical');
  bar.setAttribute('aria-label', 'Resize panel');
  bar.setAttribute('aria-valuemin', String(SIDE_MIN));
  bar.tabIndex = 0;
  bar.title = 'Drag to resize · double-click to reset';
  sheet.append(bar);

  let width = clamp(load());
  let frame = 0;
  let reported = width;
  const apply = (w: number, persist: boolean) => {
    width = clamp(w);
    root.style.setProperty('--side-w', `${width}px`);
    bar.setAttribute('aria-valuenow', String(width));
    bar.setAttribute('aria-valuemax', String(maxWidth()));
    if (persist) save(width);
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        const delta = width - reported;
        reported = width;
        onResize(width, delta);
      });
    }
  };
  apply(width, false);

  let startX = 0;
  let startW = 0;
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startW = width;
    bar.setPointerCapture(e.pointerId);
    root.classList.add('side-resizing');
  });
  bar.addEventListener('pointermove', (e) => {
    if (!bar.hasPointerCapture(e.pointerId)) return;
    apply(startW + (e.clientX - startX), false);
  });
  const end = (e: PointerEvent) => {
    if (!bar.hasPointerCapture(e.pointerId)) return;
    bar.releasePointerCapture(e.pointerId);
    root.classList.remove('side-resizing');
    apply(width, true);
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
  bar.addEventListener('dblclick', () => apply(SIDE_DEFAULT, true));
  bar.addEventListener('keydown', (e) => {
    const next =
      e.key === 'ArrowLeft' ? width - STEP : e.key === 'ArrowRight' ? width + STEP : e.key === 'Home' ? SIDE_MIN : e.key === 'End' ? maxWidth() : e.key === 'Enter' ? SIDE_DEFAULT : null;
    if (next === null) return;
    e.preventDefault();
    apply(next, true);
  });
  // Keep the saved width inside the allowed range when the window shrinks.
  window.addEventListener('resize', () => apply(load(), false));
}
