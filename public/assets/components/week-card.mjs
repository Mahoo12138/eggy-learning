import './select.mjs';
import { weekChoices, goalValue, weekPayload } from './week-card-model.mjs';

export class EggyWeekCard extends HTMLElement {
  #model;
  #listeners;
  #saving = false;
  #pendingModel;
  #rendered = false;
  save;

  get busy() { return this.#saving; }
  set model(value) {
    const copy = structuredClone(value);
    if (this.#saving) { this.#pendingModel = copy; return; }
    this.#model = copy;
    this.#rendered = false;
    this.#render();
  }

  #field(name) { return this.querySelector(`[data-week-field="${name}"]`); }
  #form() { return this.querySelector('form'); }

  connectedCallback() {
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    this.addEventListener('change', event => {
      if (event.target.name === 'mode') this.#mode();
    }, { signal });
    this.addEventListener('input', () => this.#count(), { signal });
    this.addEventListener('submit', event => this.#submit(event), { signal });
    this.#form()?.addEventListener('reset', () => queueMicrotask(() => {
      if (this.isConnected) { this.#mode(); this.#count(); }
    }), { signal });
    if (this.#model && !this.#rendered) this.#render();
  }

  disconnectedCallback() { this.#listeners?.abort(); }

  #render() {
    if (!this.isConnected || !this.#model || this.#saving) return;
    this.#rendered = true;
    const { course, week, rankId } = this.#model;
    const choices = weekChoices(course, { scope: this.getAttribute('scope') || 'all', rankId });
    this.#field('mainGoal').setOptions(choices.goals, goalValue(week.mainGoal));
    this.#field('shortLevelId').setOptions([{ value: '', label: this.getAttribute('short-label') || '不指定' }, ...choices.short], week.shortLevelId || '');
    const mode = week.mode || this.getAttribute('default-mode') || 'rest';
    this.querySelectorAll('input[name="mode"]').forEach(input => { input.defaultChecked = input.value === mode; input.checked = input.defaultChecked; });
    const days = this.#field('playDays');
    days.defaultValue = String(Math.max(1, Math.min(7, Number(week.playDays || week.preferences?.normalPlayCount || this.getAttribute('default-days') || 2))));
    days.value = days.defaultValue;
    const note = this.#field('note');
    note.defaultValue = week.note || ''; note.value = note.defaultValue;
    const start = this.#field('weekStart');
    if (start) start.textContent = week.weekStart || '本周';
    this.#mode(); this.#count();
  }

  #count() {
    const output = this.#field('count');
    if (output) output.textContent = `${this.#field('playDays').value} 次`;
  }

  #mode() {
    const rest = this.querySelector('input[name="mode"]:checked')?.value === 'rest';
    this.#form().dataset.rest = String(rest);
    for (const name of ['playDays', 'mainGoal', 'shortLevelId']) this.#field(name).disabled = rest || this.#saving;
  }

  #message(text, error = false) {
    const node = this.#field('message');
    node.textContent = text;
    node.classList.toggle('error-message', error);
    node.setAttribute('role', error ? 'alert' : 'status');
  }

  async #submit(event) {
    event.preventDefault();
    if (this.#saving || !this.#model) return;
    const form = this.#form();
    if (!form.reportValidity()) return;
    let payload;
    try {
      const rawNote = this.#field('note').value;
      payload = weekPayload(this.#model, {
        mode: this.querySelector('input[name="mode"]:checked')?.value || 'rest',
        playDays: this.#field('playDays').value, mainGoal: this.#field('mainGoal').value,
        shortLevelId: this.#field('shortLevelId').value, note: this.hasAttribute('trim-note') ? rawNote.trim() : rawNote
      });
      if (typeof this.save !== 'function') throw new Error('周卡保存尚未就绪，请重新读取页面。');
    } catch (error) { this.#message(error.message, true); return; }
    this.#saving = true;
    form.setAttribute('aria-busy', 'true');
    const controls = [...form.querySelectorAll('input,select,textarea,button')].map(node => [node, node.disabled]);
    controls.forEach(([node]) => { node.disabled = true; });
    this.#message('正在保存…');
    let saved = false;
    try {
      const week = await this.save(payload);
      if (!week || typeof week !== 'object' || !Number.isFinite(week.revision)) throw new Error('服务器未返回有效周卡，本次保存尚未确认。');
      this.#model.week = structuredClone(week);
      saved = true;
      this.#message(week.mode === 'rest' ? '已保存休息周，进度和奖励保持原样。' : '本周游玩卡已保存。');
      this.dispatchEvent(new CustomEvent('week-saved', { bubbles: true, detail: { weekCard: structuredClone(week) } }));
    } catch (error) {
      // Keep every field and the original revision for review/retry after failure.
      this.#message(`${error.message} 已填内容仍保留在本页。`, true);
      this.dispatchEvent(new CustomEvent('week-error', { bubbles: true, detail: { error } }));
    } finally {
      this.#saving = false;
      form.removeAttribute('aria-busy');
      controls.forEach(([node, disabled]) => { node.disabled = disabled; });
      // A concurrent refresh must not overwrite an unsuccessful draft.
      if (saved && this.#pendingModel) this.#model = { ...this.#pendingModel, week: this.#model.week };
      this.#pendingModel = undefined;
      if (saved) this.#render();
      else this.#mode();
    }
  }
}

if (!customElements.get('eggy-week-card')) customElements.define('eggy-week-card', EggyWeekCard);
