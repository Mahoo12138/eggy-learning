// Optional browser QA for the guided project concept gate. Uses an existing Playwright installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { startServer } from '../server.mjs';
import { freshProgress, sanitizeCourse, submitAttempt } from '../shared/park-domain.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'eggy-concepts-'));
const evidence = process.env.QA_OUTPUT || join(tmpdir(), 'eggy-concepts-qa');
await mkdir(evidence, { recursive: true });
await cp(join(projectRoot, 'data'), join(root, 'data'), { recursive: true });

const rawCourse = JSON.parse(await readFile(join(projectRoot, 'data/course.json'), 'utf8'));
const detailNames = (await readdir(join(projectRoot, 'data/levels'))).filter(name => name.endsWith('.json'));
const details = await Promise.all(detailNames.map(async name => JSON.parse(await readFile(join(projectRoot, 'data/levels', name), 'utf8'))));
const course = sanitizeCourse(rawCourse, details);

function progressAtGoose() {
  let progress = freshProgress(course, 'learner-1');
  let sequence = 0;
  const submit = input => {
    sequence += 1;
    progress = submitAttempt(course, progress, input, {
      id: `concept-browser-seed-attempt-${sequence}`,
      submittedAt: new Date(Date.UTC(2026, 9, 15, 2, sequence)).toISOString()
    }).progress;
  };
  for (const rankId of ['quail', 'pigeon', 'chicken']) {
    const rank = course.ranks.find(item => item.id === rankId);
    const boss = course.levels.find(item => item.id === rank.promotion.bossActivityId);
    for (const levelId of rank.activityIds.filter(item => item !== boss.id)) {
      const level = course.levels.find(item => item.id === levelId);
      for (const step of level.content.steps) {
        submit({
          requestId: `concept-browser-seed-${sequence + 1}`,
          levelId,
          contentVersion: level.version,
          stepId: step.id,
          variantId: step.variants?.[0]?.id || '',
          action: 'submit',
          answer: 'fixture',
          hintLevel: 0,
          viewedFullAnswer: false,
          passed: true,
          independent: step.type === 'independent-variation'
        });
      }
    }
    for (const [index, checkpoint] of boss.content.checkpoints.entries()) {
      submit({
        requestId: `concept-browser-seed-${sequence + 1}`,
        levelId: boss.id,
        contentVersion: boss.version,
        stepId: checkpoint.id,
        variantId: '',
        action: 'submit',
        answer: 'fixture',
        hintLevel: 0,
        viewedFullAnswer: false,
        passed: true,
        independent: index === boss.content.checkpoints.length - 1
      });
    }
  }
  assert.equal(progress.current.rankId, 'goose');
  return progress;
}

await writeFile(join(root, 'data/progress.json'), `${JSON.stringify(progressAtGoose(), null, 2)}\n`, 'utf8');
const originalProgress = await readFile(join(projectRoot, 'data/progress.json'), 'utf8');
const app = await startServer({ root, assetRoot: projectRoot, host: '127.0.0.1', port: 0, lock: true });
let browser;
const checks = [];
const check = (name, result = true) => {
  assert.equal(result, true, name);
  checks.push(name);
  console.log(`PASS ${name}`);
};

try {
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: process.env.HEADED !== '1' });
  const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, reducedMotion: 'reduce' });
  context.setDefaultTimeout(10_000);
  const errors = [];
  const track = page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${message.location().url}: ${message.text()}`); });
    return page;
  };
  const page = track(await context.newPage());
  await page.goto(`${app.url}/play.html?level=goose-food-street-project`);
  await page.locator('.project-concept').waitFor();

  check('第一章先显示概念现象', await page.locator('.concept-observation').isVisible());
  check('概念完成前不渲染代码和独立检查',
    await page.locator('.project-guided').count() === 0
    && await page.locator('.project-files').count() === 0
    && await page.locator('.project-runbook').count() === 0
    && await page.locator('.checkpoint-task').count() === 0
    && await page.locator('#check-step').isDisabled());
  check('概念导航一次只开放已到达阶段', await page.locator('.concept-stage-nav button:disabled').count() === 3);
  await page.screenshot({ path: join(evidence, 'concept-observation.png'), fullPage: true });

  for (const expected of ['.concept-model', '.concept-code-map', '.concept-check']) {
    await page.locator('[data-concept-action="next"]').click();
    await page.locator(expected).waitFor();
  }
  check('现象、模型、代码映射和理解检查按顺序展开');

  const project = course.projects.find(item => item.id === 'goose-food-street-project');
  const chapter = project.chapters[0];
  const [firstCheck, secondCheck] = chapter.conceptModule.checks;
  const wrongOption = firstCheck.options.find(item => item.id !== firstCheck.correctOptionId);
  await page.locator(`input[name="concept-choice"][value="${wrongOption.id}"]`).check();
  const wrongResponse = page.waitForResponse(response => response.url().endsWith('/api/play/project-concept-attempts'));
  await page.locator('[data-concept-action="check"]').click();
  check('答错请求由服务端接受', (await wrongResponse).status() === 200);
  await page.locator('.concept-feedback[data-kind="error"]').waitFor();
  check('答错后显示解释且代码保持锁定',
    (await page.locator('.concept-feedback').textContent()).includes(firstCheck.explanation)
    && await page.locator('.project-guided').count() === 0
    && await page.locator('[data-concept-action="check"]').isVisible());

  await page.locator(`input[name="concept-choice"][value="${firstCheck.correctOptionId}"]`).check();
  const firstCorrectResponse = page.waitForResponse(response => response.url().endsWith('/api/play/project-concept-attempts'));
  await page.locator('[data-concept-action="check"]').click();
  check('第一题答对由服务端判定', (await firstCorrectResponse).status() === 200);
  await page.locator('[data-concept-action="next-check"]').waitFor();
  check('答对后先保留本题解释，再由学习者继续',
    (await page.locator('.concept-feedback[data-kind="success"]').textContent()).includes(firstCheck.explanation));
  await page.locator('[data-concept-action="next-check"]').click();
  check('继续后才显示第二题', (await page.locator('.concept-check-heading strong').textContent()).includes(secondCheck.question));

  await page.locator(`input[name="concept-choice"][value="${secondCheck.correctOptionId}"]`).check();
  const secondCorrectResponse = page.waitForResponse(response => response.url().endsWith('/api/play/project-concept-attempts'));
  await page.locator('[data-concept-action="check"]').click();
  check('第二题答对由服务端判定', (await secondCorrectResponse).status() === 200);
  await page.locator('[data-concept-action="finish-concept"]').waitFor();
  check('最后一题解释在进入代码前仍可阅读',
    (await page.locator('.concept-feedback[data-kind="success"]').textContent()).includes(secondCheck.explanation));
  await page.locator('[data-concept-action="finish-concept"]').click();
  await page.locator('.project-guided').waitFor();
  check('两题通过后才解锁代码引导',
    await page.locator('.project-concept-review').isVisible()
    && await page.locator('.project-files').isVisible()
    && await page.locator('.project-runbook').isVisible()
    && await page.locator('.project-guided-step').isVisible()
    && await page.locator('#check-step').isDisabled());
  check('解锁后焦点进入代码引导', await page.locator('.project-guided-step').evaluate(node => node === document.activeElement));
  await page.screenshot({ path: join(evidence, 'concept-unlocked.png'), fullPage: true });

  await page.reload();
  await page.locator('.project-guided').waitFor();
  check('刷新后从服务端恢复概念完成状态', await page.locator('.project-concept-review').isVisible());

  const cleanContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  cleanContext.setDefaultTimeout(10_000);
  const mobile = track(await cleanContext.newPage());
  await mobile.goto(`${app.url}/play.html?level=goose-food-street-project`);
  await mobile.locator('.project-guided').waitFor();
  check('无本地存储的新会话也从服务端恢复', await mobile.locator('.project-concept-review').isVisible());
  check('390px 视口没有页面级横向溢出', await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ path: join(evidence, 'concept-mobile.png'), fullPage: true });

  const admin = track(await context.newPage());
  await admin.goto(`${app.url}/admin.html`);
  await admin.locator('#rank-select-input option').first().waitFor({ state: 'attached' });
  await admin.locator('[data-tab="archive"]').click();
  check('管理端显示三次概念作答和状态',
    await admin.locator('#attempt-table tbody tr').count() >= 3
    && await admin.locator('#attempt-table').getByText('理解通过', { exact: true }).count() >= 2
    && await admin.locator('#attempt-table').getByText('需要重看', { exact: true }).count() >= 1
    && (await admin.locator('#attempt-table').textContent()).includes(firstCheck.question));

  await admin.locator('[data-tab="workshop"]').click();
  await admin.locator('#rank-select-input').selectOption('goose');
  await admin.locator('#course-editor-section').selectOption('chapter-0');
  check('课程工坊把概念模块拆成独立编辑节点',
    await admin.locator('[data-editor-node="chapter-0-concept-model"]').isVisible()
    && await admin.locator('[data-editor-node="chapter-0-concept-code"]').isVisible()
    && await admin.locator('[data-editor-node="chapter-0-concept-check-0"]').isVisible());
  await admin.locator('[data-editor-node="chapter-0-concept-model"]').click();
  check('概念编辑节点呈现白话目标和心智模型',
    (await admin.locator('#content-editor').textContent()).includes('理解目标')
    && (await admin.locator('#content-editor').textContent()).includes('心智模型'));

  const state = await context.request.get(`${app.url}/api/admin/state`).then(response => response.json());
  check('三次概念作答持久化且没有生成作品完成或奖励',
    state.progress.conceptAttempts.length === 3
    && state.progress.conceptAttempts.filter(item => item.result.passed).length === 2
    && state.progress.projectArtifacts.length === 0
    && state.progress.awardLedger.length === progressAtGoose().awardLedger.length);
  check('无浏览器运行错误', errors.length === 0);
  check('正式学习进度未被隔离 QA 修改', await readFile(join(projectRoot, 'data/progress.json'), 'utf8') === originalProgress);
  console.log(JSON.stringify({ checks: checks.length, browser: 'Microsoft Edge', url: app.url, evidence, errors }));
  await cleanContext.close();
} finally {
  await browser?.close();
  await app.close();
  await rm(root, { recursive: true, force: true });
}
