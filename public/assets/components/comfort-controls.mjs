import { subscribeComfort, toggleComfort, readComfort } from '../comfort.mjs';
import { playTone } from '../park-ui.mjs';

export class EggyComfortControls extends HTMLElement {
  #listeners;
  #unsubscribe;
  connectedCallback() {
    this.#listeners?.abort(); this.#unsubscribe?.();
    this.#listeners = new AbortController();
    this.addEventListener('click', event => {
      const button = event.target.closest('button[data-comfort]');
      if (!button || !this.contains(button)) return;
      toggleComfort(button.dataset.comfort);
      if (!readComfort().muted) playTone('tap');
    }, { signal: this.#listeners.signal });
    this.#unsubscribe = subscribeComfort(value => {
      for (const button of this.querySelectorAll('[data-comfort]')) {
        const sound = button.dataset.comfort === 'sound';
        const pressed = sound ? value.muted : value.reducedMotion;
        const label = sound ? (pressed ? '声音已关' : '声音已开') : (pressed ? '减少动效' : '标准动效');
        button.setAttribute('aria-pressed', String(pressed));
        button.setAttribute('aria-label', label);
        button.title = sound ? `${label}，点击${pressed ? '开启' : '静音'}` : `${label}，点击切换`;
        button.querySelector('[data-comfort-label]')?.replaceChildren(label);
      }
    });
  }
  disconnectedCallback() { this.#listeners?.abort(); this.#unsubscribe?.(); }
}
if (!customElements.get('eggy-comfort-controls')) customElements.define('eggy-comfort-controls', EggyComfortControls);
