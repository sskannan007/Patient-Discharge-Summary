/**
 * Grow textareas to fit all content (no inner scroll) for UI, print, and PDF.
 * Bootstrap + fixed `rows` keep a minimum box height; we must collapse before
 * measuring or scrollHeight stays too small.
 */

function lineHeightAndPadding(el) {
  const cs = getComputedStyle(el);
  const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  let lh = parseFloat(cs.lineHeight);
  if (Number.isNaN(lh)) {
    const fs = parseFloat(cs.fontSize) || 14;
    lh = Math.round(fs * 1.45);
  }
  return { lh, pad, fs: parseFloat(cs.fontSize) || 14 };
}

/** Minimum visual height from `rows` (or one line if unset). */
export function minHeightFromRows(el) {
  const { lh, pad } = lineHeightAndPadding(el);
  const rows = parseInt(el.getAttribute('rows'), 10);
  const n = rows > 0 ? rows : 1;
  return Math.ceil(n * lh + pad);
}

/**
 * Measure full content height after collapsing the box (beats Bootstrap min-height + rows).
 */
export function resizeTextareaToContent(ta) {
  if (!ta || ta.tagName !== 'TEXTAREA' || !ta.isConnected) return;

  const floor = minHeightFromRows(ta);

  ta.style.overflow = 'hidden';
  ta.style.boxSizing = 'border-box';

  ta.style.setProperty('min-height', '0', 'important');
  ta.style.setProperty('height', '0', 'important');
  void ta.offsetHeight;

  const contentH = ta.scrollHeight;
  const next = Math.max(contentH + 4, floor);

  ta.style.removeProperty('min-height');
  ta.style.removeProperty('height');

  /* !important beats print/PDF .form-control rules that still target textarea */
  ta.style.setProperty('min-height', `${floor}px`, 'important');
  ta.style.setProperty('height', `${next}px`, 'important');
}

export function resizeAllTextareasIn(root) {
  if (!root) return;
  root.querySelectorAll('textarea').forEach((ta) => resizeTextareaToContent(ta));
}

/**
 * @param {HTMLElement | null} root
 * @returns {() => void} cleanup
 */
export function attachTextareaAutoResize(root) {
  if (!root) return () => {};

  const scheduleResize = (target) => {
    if (target?.tagName === 'TEXTAREA') {
      requestAnimationFrame(() => resizeTextareaToContent(target));
    }
  };

  const onInput = (e) => scheduleResize(e.target);
  const onPaste = () => {
    requestAnimationFrame(() => resizeAllTextareasIn(root));
  };

  const onPrint = () => resizeAllTextareasIn(root);

  root.addEventListener('input', onInput, true);
  root.addEventListener('change', onInput, true);
  root.addEventListener('paste', onPaste, true);
  window.addEventListener('beforeprint', onPrint);

  const ro = new ResizeObserver(() => resizeAllTextareasIn(root));
  ro.observe(root);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => resizeAllTextareasIn(root));
  });

  return () => {
    root.removeEventListener('input', onInput, true);
    root.removeEventListener('change', onInput, true);
    root.removeEventListener('paste', onPaste, true);
    window.removeEventListener('beforeprint', onPrint);
    ro.disconnect();
  };
}

/**
 * html2canvas paints textarea/input text with a broken vertical bounds (clips multiline text).
 * Run only on html2canvas' cloned document: swap fields for divs that layout like normal text.
 */
export function mirrorFormFieldsForHtml2CanvasClone(root) {
  if (!root?.ownerDocument?.defaultView) return;
  const doc = root.ownerDocument;
  const win = doc.defaultView;

  const copyChrome = (fromEl, toEl) => {
    const cs = win.getComputedStyle(fromEl);
    let w = cs.width;
    if (!w || w === '0px' || parseFloat(w) < 4) {
      w = fromEl.offsetWidth > 0 ? `${fromEl.offsetWidth}px` : '100%';
    }
    toEl.style.boxSizing = 'border-box';
    toEl.style.width = w;
    toEl.style.maxWidth = '100%';
    const measuredHeight =
      (fromEl.scrollHeight && fromEl.scrollHeight > 4 && fromEl.scrollHeight) ||
      (fromEl.offsetHeight && fromEl.offsetHeight > 4 && fromEl.offsetHeight) ||
      parseFloat(cs.height) ||
      parseFloat(cs.minHeight) ||
      0;
    if (measuredHeight) {
      toEl.style.minHeight = `${measuredHeight}px`;
      toEl.style.height = `${measuredHeight}px`;
    }
    toEl.style.padding = cs.padding;
    toEl.style.borderWidth = cs.borderWidth;
    toEl.style.borderStyle = cs.borderStyle;
    toEl.style.borderColor = cs.borderColor;
    toEl.style.borderRadius = cs.borderRadius;
    toEl.style.fontFamily = cs.fontFamily;
    toEl.style.fontSize = cs.fontSize;
    toEl.style.fontWeight = cs.fontWeight;
    toEl.style.lineHeight = cs.lineHeight;
    toEl.style.color = cs.color;
    toEl.style.backgroundColor = cs.backgroundColor;
    toEl.style.textAlign = cs.textAlign;
    toEl.style.whiteSpace = 'pre-wrap';
    toEl.style.wordBreak = 'break-word';
    toEl.style.overflow = 'visible';
  };

  Array.from(root.querySelectorAll('textarea')).forEach((ta) => {
    const div = doc.createElement('div');
    div.className = `${ta.className} ds-pdf-field-mirror`.trim();
    if (ta.getAttribute('aria-label')) {
      div.setAttribute('aria-label', ta.getAttribute('aria-label'));
    }
    div.textContent = ta.value;
    copyChrome(ta, div);
    ta.parentNode.replaceChild(div, ta);
  });

  Array.from(root.querySelectorAll('input.form-control')).forEach((inp) => {
    const t = inp.type ? inp.type.toLowerCase() : 'text';
    if (!['text', 'search', 'tel', 'email', 'url'].includes(t)) return;
    const div = doc.createElement('div');
    div.className = `${inp.className} ds-pdf-field-mirror`.trim();
    if (inp.getAttribute('aria-label')) {
      div.setAttribute('aria-label', inp.getAttribute('aria-label'));
    }
    div.textContent = inp.value;
    copyChrome(inp, div);
    inp.parentNode.replaceChild(div, inp);
  });
}
