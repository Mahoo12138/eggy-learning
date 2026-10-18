// Optional browser QA. Uses an existing Playwright installation; no application build.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, cp, rm, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const project = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'eggy-components-'));
const evidence = process.env.QA_OUTPUT || join(tmpdir(), 'eggy-components-qa');
await mkdir(evidence, { recursive: true });
await cp(join(project, 'data'), join(root, 'data'), { recursive: true });
const unchanged = await Promise.all(['progress', 'course', 'week-card'].map(name => readFile(join(project, `data/${name}.json`), 'utf8')));
const app = await startServer({ root, assetRoot: project, port: 0 });
let browser;
const checks = [];
const check = (name, result = true) => { assert.equal(result, true, name); checks.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: process.env.HEADED !== '1' });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10_000);
  const errors = [];
  const page = await context.newPage();
  const admin = await context.newPage();
  for (const tab of [page, admin]) {
    tab.on('pageerror', error => errors.push(error.message));
    tab.on('console', message => { if (message.type() === 'error') errors.push(`${message.location().url}: ${message.text()}`); });
  }
  await page.goto(`${app.url}/learner.html#week`);
  await page.locator('#main-goal-input option').first().waitFor({ state: 'attached' });
  check('学习者周卡加载、ESM 注册与同源 CSP', await page.locator('eggy-week-card').evaluate(node => node.constructor.name === 'EggyWeekCard'));
  check('页面身份与正文', (await page.title()).includes('蛋仔编程乐园') && await page.locator('#week-title').isVisible());
  await admin.goto(`${app.url}/admin.html`);
  await admin.locator('#rank-select-input option').first().waitFor({ state: 'attached' });
  await admin.locator('[data-tab="operations"]').click();
  // Both pages now hold the same revision. Save one, then reject the other's stale draft.
  await page.locator('label:has(input[name=mode][value=active])').click();
  const initialGoal = await page.locator('#main-goal-input').inputValue();
  await page.locator('#week-note').fill('正常 → 休息 → 正常');
  await page.locator('label:has(input[name=mode][value=rest])').click();
  check('休息禁用原生字段', await page.locator('#main-goal-input').isDisabled());
  await page.locator('label:has(input[name=mode][value=active])').click();
  check('模式往返保留目标与备注', await page.locator('#main-goal-input').inputValue() === initialGoal && await page.locator('#week-note').inputValue() === '正常 → 休息 → 正常');
  await page.locator('label[for="main-goal-input"]').click();
  check('外部 label 关联原生选择输入', await page.locator('#main-goal-input').evaluate(node => node === document.activeElement));
  await page.locator('#main-goal-input').press('ArrowDown');
  await page.locator('#main-goal-input').press('Enter');
  await page.locator('#save-week-card').click();
  await page.locator('#week-form-message').filter({ hasText: '已保存' }).waitFor();
  check('学习者真实 HTTP 保存成功');
  await admin.locator('label:has(input[name=mode][value=rest])').click();
  await admin.locator('#admin-week-note').fill('冲突草稿保留');
  await admin.locator('#week-card-form button[type=submit]').click();
  await admin.locator('[data-week-field=message]').filter({ hasText: '另一个页面更新' }).waitFor();
  check('过期版本冲突保留草稿', await admin.locator('#admin-week-note').inputValue() === '冲突草稿保留');
  await admin.reload();
  await admin.locator('#rank-select-input option').first().waitFor({ state: 'attached' });
  await admin.locator('[data-tab="operations"]').click();
  check('管理者重新读取学习者保存数据', await admin.locator('#admin-week-note').inputValue() === '正常 → 休息 → 正常');
  await admin.locator('label:has(input[name=mode][value=rest])').click();
  await admin.locator('#week-card-form button[type=submit]').click();
  await admin.locator('[data-week-field=message]').filter({ hasText: '已保存休息周' }).waitFor();
  const saved = await context.request.get(`${app.url}/api/play/home`).then(response => response.json());
  check('休息保存清空目标与次数', saved.weekCard.playDays === 0 && saved.weekCard.mainGoal === null && saved.weekCard.shortLevelId === '');
  await page.reload();
  await page.locator('#main-goal-input option').first().waitFor({ state: 'attached' });
  check('两端保存后互相读取一致', await page.locator('input[name=mode][value=rest]').isChecked());
  // HTTP interruption and duplicate submission: let the component own the gate.
  await page.locator('label:has(input[name=mode][value=active])').click();
  await page.locator('#week-note').fill('网络中断草稿');
  let requests = 0;
  await page.route('**/api/play/week-card', async route => {
    requests++; await new Promise(resolve => setTimeout(resolve, 250)); await route.abort('failed');
  });
  await page.evaluate(() => {
    const form = document.querySelector('#week-card-form');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.locator('#week-form-message').filter({ hasText: '仍保留' }).waitFor();
  check('重复提交受保护、失败保留输入', requests === 1 && await page.locator('#week-note').inputValue() === '网络中断草稿');
  await page.unroute('**/api/play/week-card');
  // Expected browser network error from the deliberately interrupted request.
  const expectedErrors = new Set([
    `${app.url}/api/play/week-card: Failed to load resource: the server responded with a status of 412 (Precondition Failed)`,
    `${app.url}/api/play/week-card: Failed to load resource: net::ERR_FAILED`
  ]);
  const relevantErrors = () => errors.filter(error => !expectedErrors.has(error));
  // Real disconnected/reconnected elements must keep drafts and avoid duplicate listeners.
  await page.evaluate(() => {
    const node = document.querySelector('#week-editor'); const parent = node.parentNode;
    node.remove(); parent.append(node);
  });
  check('周卡移除重挂保留草稿', await page.locator('#week-note').inputValue() === '网络中断草稿');
  await page.evaluate(() => document.querySelector('#week-card-form').reset());
  check('原生 reset 恢复数据和休息模式', await page.locator('input[name=mode][value=rest]').isChecked() && await page.locator('#main-goal-input').isDisabled());
  // Technical module: atomic options, unavailable selection, text safety and native form data.
  const selectResult = await page.evaluate(() => {
    const form = document.createElement('form');
    form.innerHTML = '<fieldset><label for="probe-input">测试选择</label><eggy-select id="probe"><select id="probe-input" name="probe" required></select></eggy-select></fieldset>';
    document.body.append(form);
    const host = form.querySelector('eggy-select');
    host.setOptions([{ value: 'a', label: '<img src=x onerror=alert(1)>' }, { value: 'b', label: 'B' }], 'a');
    const safe = !host.querySelector('img') && new FormData(form).get('probe') === 'a';
    let duplicate = false; try { host.setOptions([{ value: 'a' }, { value: 'a' }]); } catch { duplicate = host.value === 'a'; }
    host.setOptions([{ value: 'b', label: 'B' }], 'gone');
    const missing = host.value === 'gone' && !form.checkValidity();
    host.value = 'b';
    const valid = form.checkValidity();
    form.querySelector('fieldset').disabled = true;
    const disabled = !new FormData(form).has('probe');
    form.remove(); return { safe, duplicate, missing, valid, disabled };
  });
  check('select 原子更新、失效值、文本安全与 FormData', Object.values(selectResult).every(Boolean));
  // Workshop editing: visual-first flow, real persistence, mirror invariants and raw-draft rollback.
  await admin.locator('[data-tab="workshop"]').click();
  await admin.locator('#content-editor [data-editor-mode="visual"]').waitFor();
  check('课程编辑器默认进入可视化模式',
    await admin.locator('#content-editor').evaluate(node => node.constructor.name === 'EggyCourseEditor')
    && await admin.locator('#content-editor [data-editor-mode="visual"]').getAttribute('aria-pressed') === 'true'
    && await admin.locator('#content-json').count() === 0);

  const oldRank = await admin.locator('#rank-select-input').inputValue();
  const selectedContentKey = await admin.locator('#level-select-input').inputValue();
  const selectedLevelId = selectedContentKey.replace(/^level:/, '');
  const beforeCourse = await context.request.get(`${app.url}/api/admin/state`).then(response => response.json());
  const beforeLevel = beforeCourse.course.levels.find(level => level.id === selectedLevelId);
  assert.ok(beforeLevel, `expected selected level ${selectedLevelId}`);
  const editedTitle = `${beforeLevel.title} · 可视化回归`;
  const titleInput = admin.locator('#content-editor .course-editor-form input:not([readonly])').first();
  check('关卡概览呈现可编辑字段', await titleInput.inputValue() === beforeLevel.title);
  await titleInput.fill(editedTitle);
  check('可视化修改立即保留为页面草稿', (await admin.locator('#save-course').textContent()).includes('●'));
  await admin.locator('#content-editor [data-editor-node="level-learning"]').click();
  await admin.locator('#content-editor [data-editor-node="level-summary"]').click();
  check('切换编辑步骤后草稿仍在', await admin.locator('#content-editor .course-editor-form input:not([readonly])').first().inputValue() === editedTitle);

  await admin.locator('#save-course').click();
  await admin.locator('#admin-notice').filter({ hasText: '课程已通过校验并保存' }).waitFor();
  const afterCourse = await context.request.get(`${app.url}/api/admin/state`).then(response => response.json());
  const afterLevel = afterCourse.course.levels.find(level => level.id === selectedLevelId);
  check('可视化修改经真实 HTTP 保存', afterLevel?.title === editedTitle);
  check('关卡摘要与详情镜像一致', afterLevel?.content?.title === editedTitle && afterLevel.content.version === afterLevel.version);
  check('修改内容后版本与发布修订各递增一次',
    afterLevel.version === beforeLevel.version + 1
    && afterCourse.course.publishedRevision === beforeCourse.course.publishedRevision + 1);

  await admin.reload();
  await admin.locator('#rank-select-input option').first().waitFor({ state: 'attached' });
  await admin.locator('[data-tab="workshop"]').click();
  await admin.locator('#content-editor [data-editor-mode="visual"]').waitFor();
  check('页面重载后显示已保存的可视化内容', await admin.locator('#content-editor .course-editor-form input:not([readonly])').first().inputValue() === editedTitle);

  await admin.locator('#content-editor [data-editor-mode="json"]').click();
  const validLevelRaw = await admin.locator('#content-json').inputValue();
  const invalidStepsValue = JSON.parse(validLevelRaw);
  invalidStepsValue.content.steps = {};
  const invalidStepsRaw = JSON.stringify(invalidStepsValue, null, 2);
  await admin.locator('#content-json').fill(invalidStepsRaw);
  await admin.locator('#content-editor [data-apply-json]').click();
  check('高级 JSON 拒绝对象形态的 content.steps 并保持原文',
    (await admin.locator('#json-error').textContent()).includes('JSON 未采用')
    && await admin.locator('#content-editor [data-editor-mode="json"]').getAttribute('aria-pressed') === 'true'
    && await admin.locator('#content-json').inputValue() === invalidStepsRaw);
  check('结构错误后课程编辑组件仍可操作',
    await admin.locator('#content-editor').evaluate(node => node.constructor.name === 'EggyCourseEditor')
    && await admin.locator('#content-editor [data-apply-json]').isEnabled());
  await admin.locator('#content-json').fill(validLevelRaw);
  await admin.locator('#content-editor [data-apply-json]').click();
  await admin.locator('#content-editor [data-editor-mode="visual"]').waitFor();

  await admin.locator('#content-editor [data-editor-mode="json"]').click();
  const validRawDraft = await admin.locator('#content-json').inputValue();
  const invalidRawDraft = '{ "draftMarker": "不得丢失",';
  await admin.locator('#content-json').fill(invalidRawDraft);
  await admin.locator('#rank-select-input').selectOption('pigeon');
  check('课程 JSON 错误时原选择回滚', await admin.locator('#rank-select-input').inputValue() === oldRank && (await admin.locator('#json-error').textContent()).includes('JSON 未采用'));
  check('无效 JSON 阻止切换且原样保留',
    await admin.locator('#content-json').inputValue() === invalidRawDraft
    && await admin.locator('#content-editor').evaluate(node => node.value.title) === editedTitle);
  await admin.locator('[data-tab="overview"]').click();
  check('无效 JSON 阻止离开课程工坊且保留原文',
    await admin.locator('#panel-workshop').isVisible()
    && await admin.locator('[data-tab="workshop"]').getAttribute('aria-selected') === 'true'
    && await admin.locator('#content-json').inputValue() === invalidRawDraft);
  // Restore the valid disposable draft so later navigation never depends on a confirmation dialog.
  await admin.locator('#content-json').fill(validRawDraft);
  await admin.locator('#content-editor [data-apply-json]').click();
  check('恢复有效 JSON 后返回可视化模式', await admin.locator('#content-editor [data-editor-mode="visual"]').getAttribute('aria-pressed') === 'true');
  await admin.locator('[data-tab="overview"]').click();
  check('恢复有效 JSON 后可离开课程工坊', await admin.locator('#panel-overview').isVisible());
  await admin.locator('[data-tab="workshop"]').click();
  await admin.locator('#content-editor [data-editor-mode="visual"]').waitFor();

  // Primary project path: edit one guided instruction in Eggy Canteen and persist it.
  await admin.locator('#rank-select-input').selectOption('goose');
  await admin.locator('#level-select-input').waitFor();
  const selectedProjectKey = await admin.locator('#level-select-input').inputValue();
  const selectedProjectId = selectedProjectKey.replace(/^project:/, '');
  check('鹅蛋段位进入蛋仔食堂项目', selectedProjectKey.startsWith('project:') && selectedProjectId === 'goose-food-street-project');
  const beforeProjectCourse = await context.request.get(`${app.url}/api/admin/state`).then(response => response.json());
  const beforeProject = beforeProjectCourse.course.projects.find(project => project.id === selectedProjectId);
  assert.ok(beforeProject, `expected selected project ${selectedProjectId}`);
  const beforeInstruction = beforeProject.chapters[0].guidedSteps[0].instruction;
  const editedInstruction = `${beforeInstruction}（项目可视化回归）`;
  const beforeTargetFiles = beforeProject.chapters[0].guidedSteps[0].targetFiles;
  const focusedTargetFiles = [...beforeTargetFiles].reverse();
  await admin.locator('#course-editor-section').selectOption('chapter-0');
  await admin.locator('#content-editor [data-editor-node="chapter-0-guide-0"]').click();
  const instructionField = admin.locator('#content-editor label.course-editor-field').filter({ hasText: '本步任务' }).locator('textarea');
  check('蛋仔食堂第一章引导 1 呈现可编辑说明', await instructionField.inputValue() === beforeInstruction);
  await instructionField.fill(editedInstruction);
  await admin.locator('#content-editor [data-editor-node="chapter-0-guide-1"]').click();
  await admin.locator('#content-editor [data-editor-node="chapter-0-guide-0"]').click();
  check('蛋仔食堂引导说明跨节点保留草稿',
    await admin.locator('#content-editor label.course-editor-field').filter({ hasText: '本步任务' }).locator('textarea').inputValue() === editedInstruction);
  const targetFilesField = admin.locator('#content-editor label.course-editor-field').filter({ hasText: '目标文件' }).locator('textarea');
  await targetFilesField.fill(focusedTargetFiles.join('\n'));
  check('多行列表新值保持输入焦点', await targetFilesField.evaluate(node => node === document.activeElement));
  const projectSave = admin.waitForResponse(response => response.url() === `${app.url}/api/admin/course` && response.request().method() === 'PUT');
  await targetFilesField.press(process.platform === 'darwin' ? 'Meta+S' : 'Control+S');
  const projectSaveResponse = await projectSave;
  check('聚焦字段内快捷键触发课程保存', projectSaveResponse.status() === 200);
  const afterProjectCourse = await context.request.get(`${app.url}/api/admin/state`).then(response => response.json());
  const afterProject = afterProjectCourse.course.projects.find(project => project.id === selectedProjectId);
  check('蛋仔食堂引导说明经 API 保存', afterProject?.chapters?.[0]?.guidedSteps?.[0]?.instruction === editedInstruction);
  check('列表字段聚焦时快捷键保存屏幕新值',
    JSON.stringify(afterProject?.chapters?.[0]?.guidedSteps?.[0]?.targetFiles) === JSON.stringify(focusedTargetFiles));
  check('项目版本与发布修订各递增一次',
    afterProject.version === beforeProject.version + 1
    && afterProjectCourse.course.publishedRevision === beforeProjectCourse.course.publishedRevision + 1);

  await admin.reload();
  await admin.locator('#rank-select-input option').first().waitFor({ state: 'attached' });
  await admin.locator('[data-tab="workshop"]').click();
  await admin.locator('#rank-select-input').selectOption('goose');
  await admin.locator('#course-editor-section').selectOption('chapter-0');
  await admin.locator('#content-editor [data-editor-node="chapter-0-guide-0"]').click();
  check('页面重载后仍显示蛋仔食堂引导说明',
    await admin.locator('#content-editor label.course-editor-field').filter({ hasText: '本步任务' }).locator('textarea').inputValue() === editedInstruction);
  check('页面重载后仍显示聚焦保存的列表新值',
    await admin.locator('#content-editor label.course-editor-field').filter({ hasText: '目标文件' }).locator('textarea').inputValue() === focusedTargetFiles.join('\n'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'full');
  check('未明确选择时跟随系统动效变化');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.documentElement.dataset.motion === 'reduced');
  // Multiple comfort instances, reattachment and storage sync between two pages.
  await page.evaluate(() => {
    const host = document.querySelector('eggy-comfort-controls'); const parent = host.parentNode;
    host.remove(); parent.append(host);
    parent.append(host.cloneNode(true));
  });
  await page.locator('[data-comfort=sound]').first().click();
  check('重挂后一次点击只切换一次且同页同步', await page.locator('[data-comfort=sound]').evaluateAll(nodes => nodes.every(node => node.getAttribute('aria-pressed') === 'true')));
  const peer = await context.newPage();
  peer.on('pageerror', error => errors.push(error.message));
  await peer.goto(`${app.url}/play.html?level=quail-fountain-sequence`);
  await peer.locator('#play-view').waitFor({ state: 'visible' });
  check('关卡加载与跨页偏好持久化', await peer.locator('[data-comfort=sound]').getAttribute('aria-pressed') === 'true');
  await peer.locator('[data-comfort=sound]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-comfort=sound]')].every(node => node.getAttribute('aria-pressed') === 'false'));
  check('storage 事件跨页同步');
  await page.evaluate(() => {
    const host = document.querySelector('eggy-comfort-controls');
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('不可写'); };
    host.querySelector('[data-comfort=sound]').click();
    const nodes = [...document.querySelectorAll('eggy-comfort-controls')].map(node => [node, node.parentNode]);
    nodes.forEach(([node]) => node.remove());
    nodes.forEach(([node, parent]) => parent.append(node));
    Storage.prototype.setItem = original;
  });
  check('存储读成功写失败，所有实例重挂仍保留偏好', await page.locator('[data-comfort=sound]').first().getAttribute('aria-pressed') === 'true');
  await page.locator('[data-comfort=motion]').first().click();
  check('用户动效设置更新根状态', await page.locator('html').getAttribute('data-motion') === 'full');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check('用户明确动效选择优先于后续系统变化', await page.locator('html').getAttribute('data-motion') === 'full');
  // Timer replacement and actionable error display.
  await page.evaluate(() => {
    const notice = document.querySelector('#app-notice');
    notice.show('旧消息', { duration: 5 }); notice.show('新消息', { duration: 1000 });
  });
  await new Promise(resolve => setTimeout(resolve, 30));
  check('旧计时器不会隐藏新消息', await page.locator('#app-notice').isVisible() && await page.locator('#app-notice').textContent() === '新消息');
  await page.evaluate(() => document.querySelector('#app-notice').show('<script>提示</script>', { kind: 'error', duration: 5 }));
  await new Promise(resolve => setTimeout(resolve, 30));
  check('错误持续显示并作为安全文本', await page.locator('#app-notice').isVisible() && await page.locator('#app-notice').getAttribute('role') === 'alert' && await page.locator('#app-notice script').count() === 0);
  await page.evaluate(() => document.querySelector('#app-notice').show(''));
  await page.screenshot({ path: join(evidence, 'week-error-desktop.png'), fullPage: false });
  await page.reload();
  await page.locator('#main-goal-input option').first().waitFor({ state: 'attached' });
  await page.locator('label:has(input[name=mode][value=active])').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, 'week-desktop.png'), fullPage: false });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: join(evidence, 'week-mobile.png'), fullPage: true });
  check('移动端无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await peer.screenshot({ path: join(evidence, 'play-desktop.png'), fullPage: false });
  // Read-only smoke against the user's existing server, when available.
  if (process.env.LIVE_URL) {
    const live = await context.newPage(); live.on('pageerror', error => errors.push(error.message));
    await live.goto(`${process.env.LIVE_URL}/learner.html#week`);
    await live.locator('#main-goal-input option').first().waitFor({ state: 'attached' });
    check('现有服务读取新模块', await live.locator('eggy-week-card').evaluate(node => node.constructor.name === 'EggyWeekCard'));
  }
  console.log(JSON.stringify({ expectedFaults: errors.filter(error => expectedErrors.has(error)), unexpectedErrors: relevantErrors() }));
  check('无相关浏览器运行错误', relevantErrors().length === 0);
  check('正式数据未被 QA 修改', (await Promise.all(['progress', 'course', 'week-card'].map(name => readFile(join(project, `data/${name}.json`), 'utf8')))).every((value, index) => value === unchanged[index]));
  console.log(JSON.stringify({ checks: checks.length, browser: 'Microsoft Edge', url: app.url, evidence, errors: relevantErrors() }));
} finally {
  await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true });
}
