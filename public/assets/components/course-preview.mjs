const stylesheet = new URL('./course-preview.css', import.meta.url).href;
if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === stylesheet)) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheet;
  document.head.append(link);
}

let nextId = 0;

// The native dialog owns modality, focus containment and return focus. The frame
// uses the real learner renderer; only a cloned course snapshot crosses the seam.
export class EggyCoursePreview extends HTMLElement {
  #dialog;
  #frame;
  #snapshot;
  #listeners;
  #timer;
  #index = 0;
  #steps = [];
  #busy = false;
  #opener;

  connectedCallback() {
    if (!this.#dialog) this.#render();
    this.#listeners?.abort();
    this.#listeners = new AbortController();
    const { signal } = this.#listeners;
    this.addEventListener('click', event => {
      if (event.target.closest('[data-preview-close]')) this.close();
      if (event.target.closest('[data-preview-previous]')) this.#go(this.#index - 1);
      if (event.target.closest('[data-preview-next]')) this.#go(this.#index + 1);
      if (event.target.closest('[data-preview-reset], [data-preview-retry]')) this.#mountFrame();
    }, { signal });
    this.querySelector('[data-preview-step]').addEventListener('change', event => this.#go(Number(event.target.value)), { signal });
    this.#dialog.addEventListener('close', () => { if (!this.#dialog.open) this.#cleanup(); }, { signal });
    window.addEventListener('message', event => this.#receive(event), { signal });
  }

  disconnectedCallback() {
    this.close();
    this.#cleanup();
    this.#listeners?.abort();
  }

  show({ course, activityId, mode = 'level', dirty = false }) {
    if (!this.isConnected) throw new Error('请先将模拟学习组件加入页面。');
    const item = (mode === 'project' ? course?.projects : course?.levels)?.find(entry => entry.id === activityId);
    if (!item) throw new Error('请先选择一个关卡或作品，再开始模拟学习。');
    this.#snapshot = structuredClone({ course, activityId, mode });
    this.querySelector('[data-preview-title]').textContent = item.title || item.name || activityId;
    this.querySelector('[data-preview-source]').textContent = dirty ? '当前草稿 · 含未保存修改' : '当前课程';
    if (!this.#dialog.open) {
      this.#opener = document.activeElement;
      this.#dialog.showModal();
      document.body.classList.add('eggy-preview-open');
    }
    this.#mountFrame();
  }

  close() {
    if (!this.#dialog?.open) return;
    this.#dialog.close();
    this.#cleanup();
  }

  #render() {
    const id = `eggy-course-preview-${++nextId}`;
    this.innerHTML = `<dialog class="course-preview-dialog" aria-labelledby="${id}-title" aria-describedby="${id}-description">
      <header class="course-preview-header">
        <div class="course-preview-heading"><h2 id="${id}-title">模拟学习<span data-preview-source></span></h2><p data-preview-title></p></div>
        <button type="button" class="button quiet" data-preview-close autofocus>返回工坊</button>
      </header>
      <div class="course-preview-toolbar">
        <div class="course-preview-picker"><label for="${id}-step">直接切题</label><select id="${id}-step" data-preview-step disabled aria-describedby="${id}-description"><option>正在读取题目…</option></select></div>
        <div class="course-preview-navigation"><button type="button" class="button" data-preview-previous disabled>上一题</button><button type="button" class="button" data-preview-next disabled>下一题</button><button type="button" class="button quiet" data-preview-reset>重置模拟</button></div>
        <p id="${id}-description">无需作答即可切题；运行、提示和尝试仅用于本次模拟，不计入学习档案。</p>
      </div>
      <div class="course-preview-stage" aria-busy="true">
        <div class="course-preview-state" role="status" aria-live="polite"><p data-preview-message>正在载入学习者视角…</p><button type="button" class="button" data-preview-retry hidden>重新载入</button></div>
        <div class="course-preview-frame-host"></div>
      </div>
    </dialog>`;
    this.#dialog = this.querySelector('dialog');
  }

  #mountFrame() {
    if (!this.#snapshot || !this.#dialog.open) return;
    clearTimeout(this.#timer);
    this.#steps = []; this.#index = 0; this.#busy = true;
    this.querySelector('[data-preview-step]').replaceChildren(new Option('正在读取题目…', ''));
    this.#updateNavigation();
    this.querySelector('.course-preview-stage').setAttribute('aria-busy', 'true');
    this.querySelector('.course-preview-state').hidden = false;
    this.querySelector('[data-preview-message]').textContent = '正在载入学习者视角…';
    this.querySelector('[data-preview-retry]').hidden = true;
    const frame = document.createElement('iframe');
    frame.title = '课程模拟 · 学习者视角';
    frame.src = '/play.html?preview=workshop';
    this.#frame = frame;
    this.querySelector('.course-preview-frame-host').replaceChildren(frame);
    this.#timer = setTimeout(() => this.#error('学习者视角未能载入。请检查本地服务后重新载入，工坊草稿仍保留。'), 15_000);
  }

  #receive(event) {
    if (!this.#dialog.open || event.origin !== location.origin || event.source !== this.#frame?.contentWindow) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'eggy-preview-ready') this.#send({ type: 'eggy-preview-load', ...this.#snapshot });
    if (message.type === 'eggy-preview-close') this.close();
    if (message.type === 'eggy-preview-error') this.#error(message.message || '这份内容暂时无法预览，请返回工坊检查课程。');
    if (message.type !== 'eggy-preview-state' || message.activityId !== this.#snapshot.activityId || !Array.isArray(message.steps)) return;
    clearTimeout(this.#timer);
    this.#steps = message.steps;
    this.#index = Number.isInteger(message.index) ? message.index : 0;
    this.#busy = message.submitting === true;
    const select = this.querySelector('[data-preview-step]');
    const options = this.#steps.map((step, index) => new Option(`${index + 1} / ${this.#steps.length} · ${step.title || step.id || '未命名步骤'}`, String(index)));
    select.replaceChildren(...(options.length ? options : [new Option('当前内容还没有题目', '')]));
    select.value = String(this.#index);
    this.#updateNavigation();
    this.querySelector('.course-preview-stage').setAttribute('aria-busy', 'false');
    this.querySelector('.course-preview-state').hidden = true;
  }

  #go(index) {
    if (this.#busy || !Number.isInteger(index) || index < 0 || index >= this.#steps.length) return;
    this.#index = index;
    this.#updateNavigation();
    this.#send({ type: 'eggy-preview-step', index });
  }

  #updateNavigation() {
    const unavailable = this.#busy || !this.#steps.length;
    this.querySelector('[data-preview-step]').disabled = unavailable;
    this.querySelector('[data-preview-step]').value = String(this.#index);
    this.querySelector('[data-preview-previous]').disabled = unavailable || this.#index <= 0;
    this.querySelector('[data-preview-next]').disabled = unavailable || this.#index >= this.#steps.length - 1;
  }

  #send(message) { this.#frame?.contentWindow?.postMessage(message, location.origin); }

  #error(message) {
    clearTimeout(this.#timer);
    this.#busy = true; this.#updateNavigation();
    this.querySelector('.course-preview-stage').setAttribute('aria-busy', 'false');
    this.querySelector('.course-preview-state').hidden = false;
    this.querySelector('[data-preview-message]').textContent = message;
    this.querySelector('[data-preview-retry]').hidden = false;
  }

  #cleanup() {
    clearTimeout(this.#timer);
    this.#frame?.remove(); this.#frame = null; this.#snapshot = null;
    if (!document.querySelector('eggy-course-preview dialog[open]')) document.body.classList.remove('eggy-preview-open');
    if (this.#opener?.isConnected) this.#opener.focus({ preventScroll: true });
    this.#opener = null;
  }
}

if (!customElements.get('eggy-course-preview')) customElements.define('eggy-course-preview', EggyCoursePreview);
