// Feedback popup, opened from the panel footer. Posts to /api/feedback.php, which mails the site owner
// through the Gmail API; the owner's address never reaches the browser. The draft survives closing the
// popup (this visit only), so an accidental Escape loses nothing.
import { el, clear } from './dom';
import { icon } from './icons';

const MAX = 2000;
const ENDPOINT = '/api/feedback.php';

type Kind = 'idea' | 'problem' | 'other';

export function mountFeedback(): { open(): void; button: HTMLButtonElement } {
  const close = el('button', { type: 'button', class: 'icon-btn dlg-close', 'aria-label': 'Close feedback', id: 'feedback-close' }, icon('close', 20));
  const kinds: [Kind, string][] = [
    ['idea', 'Idea'],
    ['problem', 'Problem'],
    ['other', 'Other'],
  ];
  const kindInputs = kinds.map(([v, label], i) => {
    const r = el('input', { type: 'radio', name: 'fb-kind', value: v, id: `fb-kind-${v}` }) as HTMLInputElement;
    r.checked = i === 0;
    return { r, label: el('label', { class: 'opt', for: `fb-kind-${v}` }, r, el('span', { text: label })) };
  });
  const msg = el('textarea', {
    id: 'fb-message',
    rows: 6,
    maxlength: MAX,
    placeholder: 'What worked, what did not, what you wish it did…',
    required: '',
  }) as HTMLTextAreaElement;
  const count = el('span', { class: 'fb-count num', 'aria-hidden': 'true' });
  const email = el('input', { type: 'email', id: 'fb-email', maxlength: 200, autocomplete: 'email', placeholder: 'you@example.com' }) as HTMLInputElement;
  // Hidden from people (and screen readers); bots fill it and get a fake success.
  const trap = el('input', { type: 'text', name: 'website', tabindex: '-1', autocomplete: 'off', class: 'fb-trap', 'aria-hidden': 'true' }) as HTMLInputElement;
  // Human check: a small sum from the server (signed token, one use). Bots that skip it get nothing sent.
  const qText = el('span', { class: 'fb-q num', id: 'fb-q', text: '…' });
  const answer = el('input', { type: 'text', id: 'fb-answer', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 3, autocomplete: 'off', 'aria-describedby': 'fb-q' }) as HTMLInputElement;
  const newQ = el('button', { type: 'button', class: 'link-btn', id: 'fb-newq', text: 'Different sum' });
  const status = el('p', { class: 'fb-status', role: 'status', 'aria-live': 'polite' });
  const send = el('button', { type: 'submit', class: 'btn primary', id: 'fb-send' }, icon('send', 18), 'Send feedback') as HTMLButtonElement;

  const form = el(
    'form',
    { class: 'fb-form', novalidate: '' },
    el('fieldset', { class: 'fb-kinds' }, el('legend', { class: 'set-label', text: 'What is it about?' }), el('div', { class: 'opts' }, ...kindInputs.map((k) => k.label))),
    el('label', { class: 'field', for: 'fb-message' }, el('span', { class: 'fb-row' }, 'Your message', count), msg),
    el('label', { class: 'field', for: 'fb-email' }, 'Email for a reply (optional)', email),
    el('div', { class: 'fb-check' }, el('label', { for: 'fb-answer' }, 'Quick check: what is ', qText, '?'), el('div', { class: 'fb-check-row' }, answer, newQ)),
    trap,
    el('div', { class: 'row-btns' }, send),
    status,
  ) as HTMLFormElement;
  const done = el('div', { class: 'fb-done', hidden: true });
  const dlg = el(
    'dialog',
    { class: 'dlg dlg-small', id: 'feedback', 'aria-labelledby': 'feedback-title' },
    el('div', { class: 'dlg-head' }, el('h2', { id: 'feedback-title', text: 'Send feedback' }), close),
    el('div', { class: 'dlg-body' }, el('p', { class: 'set-lead', text: 'It goes straight to the person who builds RainCheck (Hafiz Ruslan). No account needed.' }), form, done),
  ) as HTMLDialogElement;
  document.body.append(dlg);

  const button = el('button', { type: 'button', class: 'foot-btn', id: 'foot-feedback', 'aria-haspopup': 'dialog' }, 'Send feedback') as HTMLButtonElement;

  const updateCount = () => {
    const n = msg.value.length;
    count.textContent = n > MAX - 300 ? `${MAX - n} left` : '';
  };
  msg.addEventListener('input', () => {
    updateCount();
    if (status.classList.contains('bad')) setStatus('');
  });
  const setStatus = (text: string, bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
  };

  // ── sum ──
  let token = '';
  let qLoading: Promise<void> | null = null;
  const setQuestion = (c: { q?: string; token?: string } | null | undefined) => {
    if (!c?.q || !c.token) return false;
    token = c.token;
    qText.textContent = c.q;
    answer.value = '';
    return true;
  };
  const loadQuestion = () => {
    qLoading ??= (async () => {
      qText.textContent = '…';
      try {
        const res = await fetch(`${ENDPOINT}?challenge=1`, { signal: AbortSignal.timeout(10_000) });
        const j = (await res.json().catch(() => null)) as { q?: string; token?: string; error?: { message?: string } } | null;
        if (!setQuestion(j)) {
          token = '';
          qText.textContent = '?';
          setStatus(res.headers.get('X-RainCheck-Api') === '1' && j?.error?.message ? j.error.message : 'Could not load the check question. Try again in a moment.', true);
        }
      } catch {
        token = '';
        qText.textContent = '?';
        setStatus('Could not reach the server. Check your connection and try again.', true);
      } finally {
        qLoading = null;
      }
    })();
    return qLoading;
  };
  newQ.addEventListener('click', () => {
    setStatus('');
    void loadQuestion().then(() => answer.focus());
  });
  answer.addEventListener('input', () => {
    answer.value = answer.value.replace(/\D/g, '');
    if (status.classList.contains('bad')) setStatus('');
  });

  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const message = msg.value.trim();
    if (message.length < 3) {
      setStatus('Write a few words first.', true);
      msg.focus();
      return;
    }
    if (email.value && !email.checkValidity()) {
      setStatus('That email address does not look right.', true);
      email.focus();
      return;
    }
    if (!token) await loadQuestion();
    if (!answer.value) {
      setStatus(token ? 'Answer the small sum first.' : status.textContent || 'Could not load the check question.', true);
      answer.focus();
      return;
    }
    busy = true;
    send.disabled = true;
    setStatus('Sending…');
    const kind = (kindInputs.find((k) => k.r.checked)?.r.value ?? 'other') as Kind;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, message, email: email.value.trim(), website: trap.value, token, answer: answer.value }),
        signal: AbortSignal.timeout(20_000),
      });
      const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: { code?: string; message?: string }; challenge?: { q?: string; token?: string } | null } | null;
      if (res.ok && j?.ok) {
        token = '';
        showDone();
        return;
      }
      const fromApi = res.headers.get('X-RainCheck-Api') === '1';
      setStatus(fromApi && j?.error?.message ? j.error.message : 'Could not send right now. Your message is kept here; please try again later.', true);
      const code = j?.error?.code ?? '';
      if (code === 'wrong_answer' || code === 'challenge_expired') {
        // The token is spent either way: swap in the fresh sum that came back (or fetch one).
        if (!setQuestion(j?.challenge)) {
          token = '';
          void loadQuestion();
        }
        answer.focus();
      } else if (code === 'too_fast') {
        answer.focus();
      } else {
        token = ''; // possibly spent (the check passed, then sending failed): fetch a new sum for the next try
        void loadQuestion();
      }
    } catch {
      setStatus('Could not reach the server. Your message is kept here; check your connection and try again.', true);
    } finally {
      busy = false;
      send.disabled = false;
    }
  });

  const showDone = () => {
    form.hidden = true;
    done.hidden = false;
    clear(done);
    const again = el('button', { type: 'button', class: 'btn small', id: 'fb-again', text: 'Write another' });
    const ok = el('button', { type: 'button', class: 'btn primary', id: 'fb-close-done', text: 'Close' });
    done.append(el('p', { class: 'fb-thanks' }, icon('check', 20), 'Thanks, it is on its way.'), el('div', { class: 'row-btns' }, ok, again));
    ok.addEventListener('click', () => dlg.close());
    again.addEventListener('click', () => reset(true));
    ok.focus();
  };
  const reset = (focus: boolean) => {
    msg.value = '';
    setStatus('');
    updateCount();
    form.hidden = false;
    done.hidden = true;
    void loadQuestion();
    if (focus) msg.focus();
  };

  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
  dlg.addEventListener('close', () => {
    if (!done.hidden) reset(false); // sent: start fresh next time; unsent drafts stay
    button.focus();
  });
  const open = () => {
    if (!dlg.open) dlg.showModal();
    if (!token) void loadQuestion();
    msg.focus();
  };
  button.addEventListener('click', open);
  return { open, button };
}
