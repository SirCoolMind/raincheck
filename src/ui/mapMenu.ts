// Small menu at a map point (right-click / long-press). Arrow keys move, Enter picks, Escape or a click
// elsewhere closes. Focus returns to the map when it closes.
import { el } from './dom';
import { icon } from './icons';

export interface MenuItem {
  label: string;
  icon?: Parameters<typeof icon>[0];
  run(): void;
  danger?: boolean;
  disabled?: boolean;
}

export function mapMenu(host: HTMLElement): { open(x: number, y: number, title: string, items: MenuItem[]): void; close(): void } {
  let menu: HTMLElement | null = null;
  const close = () => {
    if (!menu) return;
    menu.remove();
    menu = null;
    document.removeEventListener('pointerdown', outside, true);
    removeEventListener('resize', close);
  };
  const outside = (e: Event) => {
    if (menu && !menu.contains(e.target as Node)) close();
  };

  const open = (x: number, y: number, title: string, items: MenuItem[]) => {
    close();
    const buttons = items.map((it) =>
      el(
        'button',
        {
          type: 'button',
          role: 'menuitem',
          class: `mm-item${it.danger ? ' danger' : ''}`,
          tabindex: '-1',
          disabled: it.disabled ? '' : undefined,
          onclick: () => {
            close();
            host.querySelector<HTMLElement>('canvas')?.focus();
            it.run();
          },
        },
        it.icon ? icon(it.icon, 18) : el('span', { class: 'mm-gap', 'aria-hidden': 'true' }),
        it.label,
      ),
    );
    menu = el('div', { class: 'map-menu', role: 'menu', 'aria-label': title }, el('p', { class: 'mm-title', text: title }), ...buttons);
    host.append(menu);
    // Keep it inside the map, flipping left/up near the edges.
    const r = host.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const left = x + m.width + 8 > r.width ? Math.max(8, x - m.width) : x;
    const top = y + m.height + 8 > r.height ? Math.max(8, y - m.height) : y;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    const live = buttons.filter((b) => !b.disabled);
    live[0]?.focus();
    menu.addEventListener('keydown', (e) => {
      const i = live.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === 'ArrowDown') live[(i + 1) % live.length]?.focus();
      else if (e.key === 'ArrowUp') live[(i - 1 + live.length) % live.length]?.focus();
      else if (e.key === 'Home') live[0]?.focus();
      else if (e.key === 'End') live[live.length - 1]?.focus();
      else if (e.key === 'Escape' || e.key === 'Tab') {
        close();
        host.querySelector<HTMLElement>('canvas')?.focus();
      } else return;
      e.preventDefault();
    });
    setTimeout(() => document.addEventListener('pointerdown', outside, true));
    addEventListener('resize', close);
  };
  return { open, close };
}
