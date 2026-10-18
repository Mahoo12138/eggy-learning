export class EggyNotice extends HTMLElement {
  #timer;
  show(message = '', { kind = 'info', duration = Number(this.getAttribute('duration') || 0) } = {}) {
    clearTimeout(this.#timer);
    this.textContent = String(message);
    this.dataset.kind = kind;
    this.classList.toggle('error', kind === 'error');
    this.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    this.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
    this.hidden = !message;
    // Actionable errors stay visible until replaced or explicitly cleared.
    if (message && kind !== 'error' && duration > 0) this.#timer = setTimeout(() => { this.hidden = true; }, duration);
  }
  disconnectedCallback() { clearTimeout(this.#timer); }
}
if (!customElements.get('eggy-notice')) customElements.define('eggy-notice', EggyNotice);
