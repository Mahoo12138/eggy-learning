import { highlightCode } from './syntax-highlight.mjs';

// This module owns its stylesheet as well as its optional, lazy language imports.
const stylesheet = new URL('./code.css', import.meta.url).href;
if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === stylesheet)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = stylesheet; document.head.append(link);
}

export class EggyCode extends HTMLElement {
  static observedAttributes = ['language', 'aria-label'];
  #source = '';
  #explicitSource = false;
  #input;
  #pre;
  #output;
  #listeners;
  #resize;
  #frame;
  #generation = 0;
  #composing = false;

  get code() { return this.#input?.value ?? this.#source; }
  set code(value) {
    this.#source = String(value ?? ''); this.#explicitSource = true;
    if (this.#input) this.#input.value = this.#source;
    this.#queue();
  }
  get language() { return this.getAttribute('language') || 'plaintext'; }
  set language(value) { this.setAttribute('language', String(value || 'plaintext')); }

  connectedCallback() {
    for (const name of ['code', 'language']) {
      if (Object.hasOwn(this, name)) { const value = this[name]; delete this[name]; this[name] = value; }
    }
    if (!this.#pre) {
      this.#input = this.querySelector('textarea');
      if (!this.#explicitSource) this.#source = this.#input ? this.#input.value : this.textContent;
      if (this.#input && this.#explicitSource) this.#input.value = this.#source;
      this.#pre = document.createElement('pre'); this.#pre.className = 'eggy-code__pre';
      this.#output = document.createElement('code'); this.#pre.append(this.#output);
      if (this.#input) {
        this.dataset.editor = 'true';
        this.#pre.setAttribute('aria-hidden', 'true');
        this.#input.classList.add('eggy-code__input');
        this.#input.wrap = 'off';
        this.prepend(this.#pre);
      } else {
        this.replaceChildren(this.#pre);
        this.#pre.tabIndex = 0;
      }
    }
    this.#listeners?.abort(); this.#resize?.disconnect();
    this.#listeners = new AbortController();
    if (this.#input) {
      const { signal } = this.#listeners;
      this.#input.addEventListener('input', event => { if (!event.isComposing && !this.#composing) this.#queue(); }, { signal });
      this.#input.addEventListener('compositionstart', () => { this.#composing = true; this.dataset.composing = 'true'; }, { signal });
      this.#input.addEventListener('compositionend', () => { this.#composing = false; delete this.dataset.composing; this.#queue(); }, { signal });
      this.#input.addEventListener('scroll', () => this.#sync(), { signal });
      this.#input.form?.addEventListener('reset', () => queueMicrotask(() => this.#queue()), { signal });
      this.#resize = new ResizeObserver(() => this.#sync()); this.#resize.observe(this.#input);
    }
    this.#queue();
  }

  disconnectedCallback() {
    this.#listeners?.abort(); this.#resize?.disconnect(); cancelAnimationFrame(this.#frame);
    this.#generation++; this.#composing = false; delete this.dataset.composing;
  }
  attributeChangedCallback() { this.#queue(); }

  #queue() {
    // Invalidate work immediately, including before the next animation frame.
    this.#generation++;
    if (!this.isConnected || !this.#pre) return;
    this.dataset.highlight = 'loading';
    this.#output.textContent = this.code;
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#paint());
  }

  async #paint() {
    const generation = this.#generation;
    const value = this.code;
    this.dataset.highlight = 'loading';
    this.#output.textContent = value;
    const result = await highlightCode(value, this.language);
    if (!this.isConnected || generation !== this.#generation) return;
    this.#output.innerHTML = result.html;
    // A trailing blank line needs a glyph in the mirror to match textarea scrolling.
    if (this.#input && value.endsWith('\n')) this.#output.append(' ');
    this.dataset.highlight = result.state;
    if (!this.#input) this.#pre.setAttribute('aria-label', this.getAttribute('aria-label') || '代码');
    this.#sync();
    if (result.error) this.dispatchEvent(new CustomEvent('code-highlight-error', { bubbles: true, detail: { error: result.error } }));
  }

  #sync() {
    if (!this.#input) return;
    const style = getComputedStyle(this.#input);
    // Match the input's viewport, excluding its native scrollbars.
    this.#pre.style.width = `${this.#input.clientWidth + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)}px`;
    this.#pre.style.height = `${this.#input.clientHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)}px`;
    this.#pre.scrollTop = this.#input.scrollTop;
    this.#pre.scrollLeft = this.#input.scrollLeft;
  }
}

if (!customElements.get('eggy-code')) customElements.define('eggy-code', EggyCode);
