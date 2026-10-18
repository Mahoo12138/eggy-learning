// Optional external-browser QA; deliberately excluded from node --test discovery.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdtemp, readFile, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';
import { freshProgress, sanitizeCourse } from '../shared/park-domain.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const project = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'eggy-highlight-'));
const evidence = process.env.QA_OUTPUT || join(tmpdir(), 'eggy-highlight-qa');
await mkdir(evidence, { recursive: true });
const formal = await Promise.all(['course', 'progress', 'week-card'].map(name => readFile(join(project, `data/${name}.json`), 'utf8')));
await cp(join(project, 'data'), join(root, 'data'), { recursive: true });
const details = await Promise.all((await readdir(join(root, 'data/levels'))).filter(name => name.endsWith('.json')).map(async name => JSON.parse(await readFile(join(root, 'data/levels', name), 'utf8'))));
const course = sanitizeCourse(JSON.parse(formal[0]), details);
const level = details.find(level => level.id === 'quail-fountain-sequence');
await writeFile(join(root, 'data/progress.json'), JSON.stringify(freshProgress(course, 'learner-1')));
const app = await startServer({ root, assetRoot: project, port: 0 });
let browser;
const checks = [];
const check = (name, value = true) => { assert.equal(value, true, name); checks.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: process.env.HEADED !== '1' });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10_000);
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const modules = [];
  page.on('request', request => { if (request.url().includes('/vendor/highlightjs/')) modules.push(request.url()); });
  const seeded = await context.request.post(`${app.url}/api/play/attempts`, {
    headers: { Origin: app.url }, data: { requestId: 'highlight-predict-seed', levelId: level.id, contentVersion: level.version, stepId: 'predict', action: 'check', answer: JSON.stringify(level.steps[0].evaluator.expected), hintLevel: 0, viewedFullAnswer: false }
  });
  assert.equal(seeded.status(), 200, await seeded.text());
  await page.goto(`${app.url}/play.html?level=${level.id}`);
  await page.locator('eggy-code[data-highlight=highlighted]').waitFor();
  check('真实关卡示例高亮、正文和同源 CSP', (await page.title()).includes(level.title) && await page.locator('eggy-code .hljs-keyword').count() > 0);
  const example = level.steps.find(step => step.id === 'run-observe').starterFiles['main.c'];
  check('只读原文和复制文本不受标记影响', await page.locator('#code-answer').inputValue() === example && await page.locator('#code-answer').getAttribute('readonly') !== null);
  check('只下载核心及 C 语言规则', modules.length === 2 && modules.some(url => url.endsWith('/core.min.js')) && modules.some(url => url.endsWith('/languages/c.min.js')));
  await page.waitForFunction(() => {
    const input = document.querySelector('#code-answer');
    return getComputedStyle(input).webkitTextFillColor === 'rgba(0, 0, 0, 0)';
  });
  check('实际显示高亮颜色并隐藏原文镜像叠字');
  await page.locator('#code-answer').evaluate(node => node.blur());
  await page.screenshot({ path: join(evidence, 'code-readonly-desktop.png'), fullPage: false });
  const runRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/play/attempts'));
  await page.locator('#check-step').click();
  const runPayload = (await runRequest).postDataJSON();
  check('评分提交的是源码而非高亮 HTML', runPayload.answer === example);
  await page.locator('#feedback-panel[data-result=passed]').waitFor();
  check('高亮示例真实 C 运行评分通过');
  await page.locator('#next-step').click();
  await page.locator('#text-answer').fill('scanf 返回成功转换的字段数；整数与 double 相乘得到 double，输入失败应在计算前结束，避免使用无效输入。');
  await page.locator('#check-step').click();
  await page.locator('#feedback-panel[data-result=passed]').waitFor();
  await page.locator('#next-step').click();
  await page.locator('eggy-code[data-highlight=highlighted]').waitFor();
  const draft = level.steps.find(step => step.id === 'short-edit').starterFiles['main.c'];
  await page.locator('#code-answer').fill(draft.replace('/ 3;', '/ 3.0;'));
  await page.locator('#code-answer').press('End');
  await page.locator('eggy-code').evaluate(host => { const node = host.querySelector('textarea'); node.setSelectionRange(10, 20); node.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('eggy-code[data-highlight=highlighted]').waitFor();
  check('编辑高亮保留原生焦点与选区', await page.locator('#code-answer').evaluate(node => node.selectionStart === 10 && node.selectionEnd === 20 && node === document.activeElement));
  await page.screenshot({ path: join(evidence, 'code-editor-desktop.png'), fullPage: false });
  const editRequest = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/play/attempts'));
  await page.locator('#check-step').click();
  check('修改代码提交保留全部源字符', (await editRequest).postDataJSON().answer === draft.replace('/ 3;', '/ 3.0;'));
  await page.locator('#feedback-panel[data-result=passed]').waitFor();
  check('引导修改真实 C 用例全部评分通过');
  // Probe the public interface while retaining a real native form input.
  await page.evaluate(() => {
    const form = document.createElement('form'); form.id = 'highlight-probe-form';
    form.innerHTML = '<label for="highlight-input">代码测试</label><eggy-code id="highlight-probe" language="c"><textarea id="highlight-input" name="source" spellcheck="false"></textarea></eggy-code>';
    document.body.append(form);
    document.querySelector('#highlight-probe').code = 'int value = 1;\n';
  });
  await page.locator('#highlight-probe[data-highlight=highlighted]').waitFor();
  await page.locator('#highlight-input').focus();
  await page.evaluate(() => {
    const host = document.querySelector('#highlight-probe'); const input = host.querySelector('textarea');
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = '// 中文输入中';
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, inputType: 'insertCompositionText' }));
  });
  check('IME 组合期间显示原生文本且不改写输入', await page.locator('#highlight-input').evaluate(node => node.value === '// 中文输入中' && getComputedStyle(node).color !== 'rgba(0, 0, 0, 0)'));
  await page.locator('#highlight-input').evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await page.locator('#highlight-probe[data-highlight=highlighted]').waitFor();
  check('IME 结束恢复高亮与原文', await page.locator('#highlight-probe .hljs-comment').textContent() === '// 中文输入中');
  await page.evaluate(() => {
    const host = document.querySelector('#highlight-probe');
    host.code = Array.from({ length: 70 }, (_, i) => `int value${i} = ${i}; // ${'long '.repeat(80)}`).join('\n') + '\n';
  });
  await page.locator('#highlight-probe[data-highlight=highlighted]').waitFor();
  await page.locator('#highlight-input').evaluate(node => { node.scrollTop = 80; node.scrollLeft = 140; node.dispatchEvent(new Event('scroll')); });
  check('长行与末尾空行的双向滚动同步', await page.locator('#highlight-probe').evaluate(host => {
    const input = host.querySelector('textarea'), pre = host.querySelector('pre');
    return input.scrollTop > 0 && input.scrollLeft > 0 && Math.abs(input.scrollTop - pre.scrollTop) < 1 && Math.abs(input.scrollLeft - pre.scrollLeft) < 1;
  }));
  await page.locator('#highlight-input').evaluate(node => { node.style.height = '350px'; });
  await page.waitForFunction(() => {
    const host = document.querySelector('#highlight-probe'), input = host.querySelector('textarea'), pre = host.querySelector('pre');
    return pre.clientHeight === input.clientHeight && pre.clientWidth === input.clientWidth;
  });
  check('textarea 原生调整尺寸后视口对齐');
  const reconnect = await page.evaluate(() => {
    const host = document.querySelector('#highlight-probe'), parent = host.parentNode, input = host.querySelector('textarea');
    const original = input.value; host.remove(); parent.append(host);
    return host.code === original && input.value === original && new FormData(parent).get('source') === original;
  });
  check('重挂与 FormData 保留源代码', reconnect);
  await page.evaluate(() => {
    document.querySelector('#highlight-input').defaultValue = 'int reset = 2;';
    document.querySelector('#highlight-probe-form').reset();
  });
  await page.locator('#highlight-probe[data-highlight=highlighted]').waitFor();
  await page.waitForFunction(() => document.querySelector('#highlight-probe code').textContent === 'int reset = 2;');
  check('原生 form reset 更新高亮');
  await page.evaluate(() => {
    const host = document.createElement('eggy-code'); host.id = 'static-probe'; host.language = 'c';
    host.code = '<img src=x onerror=alert(1)> & 中文'; document.body.append(host);
    host.code = 'const latest = 9;'; host.language = 'javascript';
  });
  await page.locator('#static-probe[data-highlight=highlighted]').waitFor();
  check('快速切换源码和语言只保留最新渲染', await page.locator('#static-probe code').textContent() === 'const latest = 9;');
  await page.locator('#static-probe').evaluate(host => { host.language = 'c'; host.code = '<img src=x onerror=alert(1)> & 中文'; });
  await page.locator('#static-probe[data-highlight=highlighted]').waitFor();
  check('HTML 字符按原文显示且不创建可执行节点', await page.locator('#static-probe img').count() === 0 && await page.locator('#static-probe code').textContent() === '<img src=x onerror=alert(1)> & 中文');
  await page.locator('#static-probe').evaluate(host => { host.language = 'unknown'; host.code = '未知语言仍可读'; });
  await page.locator('#static-probe[data-highlight=plain]').waitFor();
  check('未知语言安全显示原文', await page.locator('#static-probe code').textContent() === '未知语言仍可读');
  await page.locator('#highlight-probe').evaluate(host => { host.language = 'c'; host.code = 'x'.repeat(65537); });
  await page.locator('#highlight-probe[data-highlight=oversize]').waitFor();
  check('超长输入跳过着色但保留原生编辑', await page.locator('#highlight-input').inputValue() === 'x'.repeat(65537) && await page.locator('#highlight-input').evaluate(node => getComputedStyle(node).color !== 'rgba(0, 0, 0, 0)'));
  await page.locator('#highlight-probe').evaluate(host => { host.code = 'int value = 1;'; });
  await page.locator('#highlight-probe[data-highlight=highlighted]').waitFor();
  await page.emulateMedia({ forcedColors: 'active' });
  check('强制颜色模式保留可读原生输入', await page.locator('#highlight-input').evaluate(node => getComputedStyle(node).webkitTextFillColor !== 'rgba(0, 0, 0, 0)') && await page.locator('#highlight-probe pre').evaluate(node => getComputedStyle(node).display === 'none'));
  await page.emulateMedia({ forcedColors: 'none' });
  await page.evaluate(() => { document.querySelector('#highlight-probe-form').remove(); document.querySelector('#static-probe').remove(); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(evidence, 'code-mobile.png'), fullPage: false });
  check('手机代码区域没有页面级横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  // A separate execution context avoids reusing an already loaded highlighter.
  const failure = await browser.newContext();
  await failure.route('**/vendor/highlightjs/**', route => route.abort('failed'));
  const fallback = await failure.newPage();
  const failures = []; fallback.on('pageerror', error => failures.push(error.message));
  await fallback.goto(`${app.url}/play.html?level=${level.id}`);
  await fallback.locator('eggy-code[data-highlight=unavailable]').waitFor();
  check('依赖加载失败仍保留可读可编辑源码', await fallback.locator('#code-answer').inputValue() !== '' && await fallback.locator('#code-answer').evaluate(node => getComputedStyle(node).color !== 'rgba(0, 0, 0, 0)') && failures.length === 0);
  await failure.close();
  if (process.env.LIVE_URL) {
    const live = await context.newPage();
    await live.goto(`${process.env.LIVE_URL}/play.html?level=${level.id}`);
    // Only check module delivery; the user's current step may differ from the QA fixture.
    check('现有服务提供组件 ESM', await live.evaluate(() => customElements.get('eggy-code')?.name === 'EggyCode'));
  }
  check('无未解释的控制台或页面错误', errors.length === 0);
  check('正式课程与进度未被 QA 修改', (await Promise.all(['course', 'progress', 'week-card'].map(name => readFile(join(project, `data/${name}.json`), 'utf8')))).every((value, i) => value === formal[i]));
  console.log(JSON.stringify({ checks: checks.length, browser: 'Microsoft Edge', url: app.url, evidence, errors }));
} finally { await browser?.close(); await app.close(); await rm(root, { recursive: true, force: true }); }
