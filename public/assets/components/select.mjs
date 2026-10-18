// Light DOM intentionally keeps native labels, forms, keyboard and CSS semantics.
export class EggySelect extends HTMLElement {
  #listeners;

  get control() { return this.querySelector('select'); }
  get value() { return this.control?.value || ''; }
  set value(value) {
    this.control.value = String(value ?? '');
    this.#validate();
  }
  get disabled() { return this.control.disabled; }
  set disabled(value) { this.control.disabled = Boolean(value); }

  connectedCallback() {
    for (const name of ['value', 'disabled']) {
      if (Object.hasOwn(this, name)) { const value = this[name]; delete this[name]; this[name] = value; }
    }
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    this.addEventListener('change', () => this.#validate(), { signal });
    this.control?.form?.addEventListener('reset', () => {
      // The native reset happens after the reset event.
      queueMicrotask(() => { if (this.isConnected) this.#validate(); });
    }, { signal });
    this.#validate();
  }

  disconnectedCallback() { this.#listeners?.abort(); }

  // An explicit value establishes the form's reset baseline; otherwise preserve selection.
  setOptions(items, value = this.value) {
    const seen = new Set();
    const options = items.map(item => {
      const key = String(item.value ?? '');
      if (seen.has(key)) throw new TypeError(`重复的选择编号：${key}`);
      seen.add(key);
      const option = new Option(String(item.label ?? key), key);
      option.disabled = item.disabled === true;
      return option;
    });
    const selected = String(value ?? '');
    if (selected && !seen.has(selected)) {
      const missing = new Option(`已不可用 · ${selected}`, selected);
      missing.disabled = true;
      missing.dataset.unavailable = 'true';
      options.unshift(missing);
    }
    if (!options.length) options.push(new Option('暂无可选内容', ''));
    const baseline = options.find(option => option.value === selected) || options.find(option => !option.disabled) || options[0];
    options.forEach(option => { option.defaultSelected = option === baseline; });
    this.control.replaceChildren(...options);
    this.control.value = baseline.value;
    this.#validate();
  }

  #validate() {
    const control = this.control;
    if (!control) return;
    const selected = control.selectedOptions[0];
    control.setCustomValidity(selected?.disabled ? '原选择已不可用，请重新选择。' : '');
  }
}

if (!customElements.get('eggy-select')) customElements.define('eggy-select', EggySelect);
