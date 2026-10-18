// Optional real-browser race regression. Requires an existing Playwright installation.
// QA_PREVIEW_UNFIXED=1 reverts only the session invalidation in a temporary asset copy.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const project = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'eggy-preview-race-'));
const evidence = process.env.QA_OUTPUT || join(tmpdir(), 'eggy-preview-race-qa');
const unfixed = process.env.QA_PREVIEW_UNFIXED === '1';
const originals = await Promise.all(['course', 'progress', 'week-card'].map(name => readFile(join(project, `data/${name}.json`), 'utf8')));
const checks = [];
const check = (name, condition = true) => {
  assert.equal(condition, true, name);
  checks.push(name);
  console.log(`PASS ${name}`);
};
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function received(gate) {
  let timer;
  try {
    await Promise.race([
      gate.received.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('预览未发出预期的代码包请求')), 10_000); })
    ]);
  } finally { clearTimeout(timer); }
}
let app, browser;
try {
  await mkdir(evidence, { recursive: true });
  await cp(join(project, 'data'), join(root, 'data'), { recursive: true });
  let assetRoot = project;
  if (unfixed) {
    assetRoot = join(root, 'unfixed-assets');
    await cp(join(project, 'public'), join(assetRoot, 'public'), { recursive: true });
    await cp(join(project, 'shared'), join(assetRoot, 'shared'), { recursive: true });
    const path = join(assetRoot, 'public/assets/play.js');
    const current = await readFile(path, 'utf8');
    const fixed = '  previewRevision += 1;\n  previewSession = null;\n  const session = createCoursePreviewSession(message.course, message.mode, message.activityId);';
    const previous = '  const session = createCoursePreviewSession(message.course, message.mode, message.activityId);\n  previewRevision += 1;';
    assert.equal(current.split(fixed).length, 2, 'temporary regression proof must replace exactly one session guard');
    await writeFile(path, current.replace(fixed, previous));
    console.log('Regression proof: only the temporary asset copy uses the previous session guard.');
  }
  app = await startServer({ root, assetRoot, host: '127.0.0.1', port: 0 });
  browser = await chromium.launch({
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
    headless: process.env.HEADED !== '1'
  });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10_000);
  const response = await context.request.get(`${app.url}/api/admin/state`);
  assert.equal(response.status(), 200);
  const { course } = await response.json();
  const activityId = 'peak-delivery-center-project';
  const sourceProject = course.projects.find(item => item.id === activityId);
  assert.ok(sourceProject?.codeDelivery && sourceProject.chapters.length > 1);
  const codePath = `/api/play/projects/${activityId}/code-package`;
  const codeResponse = await context.request.get(`${app.url}${codePath}`);
  assert.equal(codeResponse.status(), 200);
  const codePayload = await codeResponse.json();
  const errors = [];
  const expectedError = `${app.url}${codePath}: Failed to load resource: the server responded with a status of 503 (Service Unavailable)`;

  // This observes completion without sleeping or modifying application state.
  // The timer runs after fetch/json and the application's async continuations;
  // its parent message follows any stale state message from that continuation.
  await context.addInitScript(() => {
    const originalFetch = window.fetch;
    let sequence = 0;
    window.fetch = async function (...args) {
      const url = String(args[0]?.url || args[0]);
      const watched = url.includes('/code-package');
      const requestId = watched ? ++sequence : 0;
      const result = await originalFetch.apply(this, args);
      if (watched) {
        const readJSON = result.json.bind(result);
        result.json = async () => {
          try { return await readJSON(); }
          finally {
            setTimeout(() => window.parent.postMessage({ type: 'qa-preview-response-settled', requestId }, location.origin), 0);
          }
        };
      }
      return result;
    };
  });

  function draft(title) {
    const value = structuredClone(course);
    value.projects.find(item => item.id === activityId).title = title;
    return value;
  }
  async function openScenario(label, requestCount) {
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${message.location().url}: ${message.text()}`);
    });
    const gates = Array.from({ length: requestCount }, () => ({ received: deferred(), release: deferred() }));
    let requests = 0;
    await page.route(`**${codePath}`, async route => {
      const gate = gates[requests++];
      if (!gate) { await route.abort(); return; }
      gate.received.resolve();
      const outcome = await gate.release.promise;
      await route.fulfill(outcome === 'success'
        ? { status: 200, json: codePayload }
        : { status: 503, json: { error: 'QA delayed source failure', code: 'qa_failure' } });
    });
    await page.goto(`${app.url}/admin.html`);
    await page.locator('#rank-select-input option').first().waitFor({ state: 'attached' });
    await page.evaluate(() => {
      window.qaPreviewMessages = [];
      window.addEventListener('message', event => {
        if (event.origin === location.origin && event.source === document.querySelector('#course-preview iframe')?.contentWindow) {
          window.qaPreviewMessages.push(event.data);
        }
      });
    });
    await page.evaluate(({ course, activityId }) => {
      document.querySelector('#course-preview').show({ course, activityId, mode: 'project', dirty: true });
    }, { course: draft(`旧草稿 · ${label}`), activityId });
    await received(gates[0]);
    const frame = page.frames().find(item => item.url().includes('/play.html?preview=workshop'));
    assert.ok(frame, 'real same-origin workshop iframe exists');
    await frame.locator('.project-concept').waitFor();
    check(`${label}：页面身份与真实课程内容`, (await page.title()).includes('岛务管理处') && await frame.locator('#play-view').isVisible());
    const send = message => page.evaluate(message => {
      document.querySelector('#course-preview iframe').contentWindow.postMessage(message, location.origin);
    }, message);
    const settled = requestId => page.waitForFunction(id => window.qaPreviewMessages.some(message => message.type === 'qa-preview-response-settled' && message.requestId === id), requestId);
    return { page, frame, gates, send, settled, requests: () => requests };
  }

  for (const outcome of ['success', 'failure']) {
    const label = `无效新草稿 + 旧请求${outcome === 'success' ? '成功' : '失败'}`;
    const scenario = await openScenario(label, 1);
    const { page, frame, gates, send, settled } = scenario;
    try {
      await send({ type: 'eggy-preview-load', mode: 'project', activityId, course: { projects: [] } });
      await frame.locator('#play-error').waitFor();
      await page.locator('#course-preview [data-preview-retry]').waitFor();
      const messageCount = await page.evaluate(() => window.qaPreviewMessages.length);
      const originalError = await frame.locator('#play-error-message').textContent();
      gates[0].release.resolve(outcome);
      await settled(1);
      const lateStates = await page.evaluate(start => window.qaPreviewMessages.slice(start).filter(message => message.type === 'eggy-preview-state'), messageCount);
      check(`${label}：不再发布旧 state`, lateStates.length === 0);
      check(`${label}：错误视图与导航保持错误态`,
        await frame.locator('#play-error').isVisible()
        && await frame.locator('#play-error-message').textContent() === originalError
        && await page.locator('#course-preview .course-preview-state').isVisible()
        && await page.locator('#course-preview [data-preview-step]').isDisabled());
      await send({ type: 'eggy-preview-step', index: 1 });
      await frame.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      check(`${label}：失效会话不能继续切题`, (await page.evaluate(start => window.qaPreviewMessages.slice(start).filter(message => message.type === 'eggy-preview-state').length, messageCount)) === 0);
      await page.screenshot({ path: join(evidence, `invalid-${outcome}.png`), fullPage: false });
    } finally { await page.close(); }
  }

  for (const outcome of ['success', 'failure']) {
    const label = `同一作品有效新草稿 + 旧请求${outcome === 'success' ? '成功' : '失败'}`;
    const scenario = await openScenario(label, 2);
    const { page, frame, gates, send, settled } = scenario;
    try {
      const newTitle = `当前草稿 · ${outcome}`;
      await send({ type: 'eggy-preview-load', mode: 'project', activityId, course: draft(newTitle) });
      await received(gates[1]);
      // Chapter navigation changes previewRevision while this session's source is pending.
      await page.locator('#course-preview [data-preview-step]').selectOption('1');
      await frame.locator('#step-title').filter({ hasText: sourceProject.chapters[1].title }).waitFor();
      await frame.locator('[data-concept-action="preview-code"]').click();
      await frame.locator('.project-code-status[data-kind="loading"]').waitFor();
      const messageCount = await page.evaluate(() => window.qaPreviewMessages.length);
      gates[0].release.resolve(outcome);
      await settled(1);
      check(`${label}：旧响应不能填充或破坏新包`,
        await frame.locator('.project-code-status[data-kind="loading"]').isVisible()
        && await frame.locator('.project-code-delivery').count() === 0
        && (await page.evaluate(start => window.qaPreviewMessages.slice(start).filter(message => message.type === 'eggy-preview-state').length, messageCount)) === 0);
      gates[1].release.resolve('success');
      await settled(2);
      await frame.locator('.project-code-delivery').waitFor();
      const secondChapter = sourceProject.chapters[1];
      const nextCode = codePayload.codePackage.steps.find(step => step.id === secondChapter.guidedSteps[1].codeStepId);
      await frame.locator('[data-guided-action="next"]').click();
      await frame.locator('.project-code-delivery header small').filter({ hasText: nextCode.toStateId }).waitFor();
      check(`${label}：切章后当前响应仍可用且能继续代码步骤`,
        await frame.locator('[data-guided-index="1"]').getAttribute('aria-current') === 'step'
        && await frame.locator('[data-code-copy]').count() > 0
        && (await page.evaluate(() => window.qaPreviewMessages.filter(message => message.type === 'eggy-preview-state').at(-1)?.title)) === newTitle
        && scenario.requests() === 2);
      await page.screenshot({ path: join(evidence, `replacement-${outcome}.png`), fullPage: false });
    } finally { await page.close(); }
  }
  check('无非预期浏览器错误', errors.filter(error => error !== expectedError).length === 0);
  check('正式课程、进度与周卡未修改', (await Promise.all(['course', 'progress', 'week-card'].map(name => readFile(join(project, `data/${name}.json`), 'utf8')))).every((value, index) => value === originals[index]));
  console.log(JSON.stringify({ checks: checks.length, browser: process.env.BROWSER_CHANNEL || 'bundled Chromium', url: app.url, evidence, unfixed, expectedFaults: errors.filter(error => error === expectedError) }));
} finally {
  await browser?.close();
  await app?.close();
  await rm(root, { recursive: true, force: true });
}
