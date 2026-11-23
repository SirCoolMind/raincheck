// Tiny DOM helpers. All dynamic text goes through textContent — never innerHTML (legacy defect #7).

type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') {
      node.className = String(v);
    } else if (k === 'text') {
      node.textContent = String(v);
    } else if (v === true) {
      node.setAttribute(k, '');
    } else {
      node.setAttribute(k, String(v));
    }
  }
  append(node, ...children);
  return node;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function setText(node: Element | null, text: string): void {
  if (node && node.textContent !== text) node.textContent = text;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector<T>(sel);

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 24-hour time field (native type=time shows AM/PM in many locales). Accepts "730", "7:30", "07.30". */
export function timeField(id: string, label?: string): HTMLInputElement {
  const i = el('input', { type: 'text', id, inputmode: 'numeric', autocomplete: 'off', maxlength: 5, placeholder: 'HH:MM', pattern: '[0-2][0-9]:[0-5][0-9]', class: 'time-field', ...(label ? { 'aria-label': label } : {}) });
  return i as HTMLInputElement;
}
export function normHHMM(v: string): string | null {
  const d = v.replace(/[^0-9]/g, '');
  if (d.length < 3 || d.length > 4) return null;
  const h = Number(d.slice(0, d.length - 2));
  const m = Number(d.slice(-2));
  if (h > 23 || m > 59) return null;
  const r = Math.round(m / 5) * 5;
  const mm = r === 60 ? 55 : r;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
