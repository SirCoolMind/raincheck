// Open/close a panel section from its heading. The choice is remembered per section in this browser.
import { el, prefersReducedMotion } from './dom';
import { icon } from './icons';

const KEY = (k: string) => `rc.fold.${k}`;

function remembered(k: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(KEY(k));
    return v === null ? dflt : v === '1';
  } catch {
    return dflt;
  }
}

export interface Fold {
  /** The toggle button (chevron + label). */
  button: HTMLButtonElement;
  isOpen(): boolean;
  set(open: boolean): void;
  onChange(cb: (open: boolean) => void): void;
}

/**
 * A disclosure button that shows or hides `body`.
 * `label` is the visible text; `kind: 'heading'` styles it as the section title, `'pill'` as a small inline control.
 */
export function fold(o: { key: string; label: string; body: HTMLElement; defaultOpen?: boolean; kind?: 'heading' | 'pill'; id?: string }): Fold {
  if (!o.body.id) o.body.id = `${o.key}-body`;
  const button = el(
    'button',
    { type: 'button', class: `fold-btn ${o.kind ?? 'heading'}`, 'aria-controls': o.body.id, ...(o.id ? { id: o.id } : {}) },
    o.kind === 'pill' ? null : icon('chevron', 18),
    el('span', { text: o.label }),
    o.kind === 'pill' ? icon('chevron', 16) : null,
  ) as HTMLButtonElement;
  const subs: ((open: boolean) => void)[] = [];
  let open = remembered(o.key, o.defaultOpen ?? true);
  const apply = () => {
    o.body.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    subs.forEach((cb) => cb(open));
  };
  // Height, top margin and opacity ease together so the content below glides instead of jumping.
  // Opening decelerates (arrives softly); closing is a touch quicker and accelerates away.
  const animateTo = (opening: boolean) => {
    const b = o.body;
    b.getAnimations().forEach((a) => a.cancel());
    if (prefersReducedMotion() || typeof b.animate !== 'function' || !b.isConnected) {
      apply();
      return;
    }
    if (opening) apply();
    const mt = getComputedStyle(b).marginTop;
    const h = `${b.offsetHeight}px`;
    const shut = { height: '0px', marginTop: '0px', opacity: 0 };
    const full = { height: h, marginTop: mt, opacity: 1 };
    b.style.overflow = 'hidden';
    const anim = b.animate(opening ? [shut, full] : [full, shut], {
      duration: opening ? 280 : 200,
      easing: opening ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'cubic-bezier(0.4, 0, 0.7, 0.2)',
    });
    if (!opening) button.setAttribute('aria-expanded', 'false');
    const done = () => {
      b.style.overflow = '';
      if (!opening && !open) apply();
    };
    anim.onfinish = done;
    anim.oncancel = () => (b.style.overflow = '');
  };
  button.addEventListener('click', () => {
    open = !open;
    try {
      localStorage.setItem(KEY(o.key), open ? '1' : '0');
    } catch {
      /* private mode: the choice lasts this visit */
    }
    animateTo(open);
  });
  apply();
  return {
    button,
    isOpen: () => open,
    set: (v) => {
      open = v;
      apply();
    },
    onChange: (cb) => {
      subs.push(cb);
      cb(open);
    },
  };
}
