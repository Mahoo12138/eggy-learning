import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store, acquireLock, httpError, fingerprint, etag, requireMatch, safeId } from './lib/store.mjs';
import { getGitHistory } from './lib/git-history.mjs';
import { cIdentifiers, runC } from './lib/c-runner.mjs';
import { runLinuxShell } from './lib/linux-shell-sim.mjs';
import { withMasteryChallenges, supportsMasteryChallenges } from './lib/mastery-challenges.mjs';
import { evaluateCoursePreview } from './lib/course-preview.mjs';
import { createProjectCodeReader } from './lib/project-code-reader.mjs';
import {
  sanitizeCourse, sanitizeProgress, sanitizeWeekCard,
  submitAttempt, submitProjectCheckpoint, submitProjectConceptCheck, summary as progressSummary
} from './shared/park-domain.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const BODY_LIMIT = 4 * 1024 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8'
};

const clone = value => structuredClone(value);
const same = (left, right) => fingerprint(left) === fingerprint(right);

async function readBody(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) throw httpError(415, '写入只接受 application/json。');
  if (Number(req.headers['content-length']) > BODY_LIMIT) throw httpError(413, '请求过大，最多 4 MB。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw httpError(413, '请求过大，最多 4 MB。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, '请求不是有效 JSON。'); }
}

function json(res, status, value, versionValue = null) {
  res.writeHead(status, {
    'Content-Type': MIME['.json'], 'Cache-Control': 'no-store',
    ...(versionValue === null ? {} : { ETag: etag(versionValue) })
  });
  res.end(JSON.stringify(value));
}

function allowedHosts(host, extra) {
  const names = new Set(['localhost', '127.0.0.1', '::1', host]);
  if (host === '0.0.0.0' || host === '::') {
    for (const list of Object.values(networkInterfaces())) for (const address of list || []) names.add(address.address.toLowerCase());
  }
  for (const item of (extra || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)) names.add(item);
  return names;
}

function validateHost(req, server, allowed) {
  const raw = req.headers.host;
  if (!raw || /[\s/@?#\\]/.test(raw)) throw httpError(403, '不允许的 Host。');
  let authority;
  try { authority = new URL(`http://${raw}`); } catch { throw httpError(403, '不允许的 Host。'); }
  const hostname = authority.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowed.has(hostname) || Number(authority.port || 80) !== server.address().port) throw httpError(403, '不允许的 Host。');
  return authority.origin;
}

function safeDetailPath(file, id) {
  if (typeof file !== 'string' || !/^levels\/[a-z0-9][a-z0-9_-]{0,159}\.json$/.test(file) || file !== `levels/${id}.json`) {
    throw httpError(400, `活动 ${id} 的详情文件路径无效。`, 'invalid_course_path');
  }
  return `data/${file}`;
}

function mondayInShanghai(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  const local = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  const weekday = local.getUTCDay() || 7;
  local.setUTCDate(local.getUTCDate() - weekday + 1);
  return local.toISOString().slice(0, 10);
}

function learnerRank(rank) {
  const value = clone(rank);
  if (value.projectId) return value;
  delete value.locationIds;
  return value;
}

function publicCourse(course) {
  const value = clone(course);
  value.ranks = value.ranks.map(learnerRank);
  value.levels = value.levels.map(level => {
    const { content, locationId, propIds, ...index } = level;
    return index;
  });
  return value;
}

function authoredFullSolution(step, variant = null) {
  const value = variant?.fullSolution ?? variant?.solution ?? step?.fullSolution ?? step?.fullAnswer;
  return typeof value === 'string' ? value : value?.text || '';
}

function learnerVariant(step, variant) {
  const value = clone(variant);
  const available = Boolean(authoredFullSolution(step, variant));
  delete value.fullSolution;
  delete value.solution;
  delete value.fullAnswer;
  value.fullSolutionAvailable = available;
  return value;
}

function learnerLevelContent(content) {
  const value = clone(content);
  delete value.scene;
  const steps = value.steps || value.checkpoints || [];
  for (const step of steps) {
    if (step.type !== 'independent-variation' || !Array.isArray(step.variants)) continue;
    const sourceStep = (content.steps || content.checkpoints || []).find(item => item.id === step.id) || step;
    step.variants = sourceStep.variants.map(variant => learnerVariant(sourceStep, variant));
    delete step.fullSolution;
    delete step.fullAnswer;
    delete step.solution;
  }
  return value;
}

function currentWeekView(course, progress, card) {
  const weekStart = mondayInShanghai();
  const saved = card.weeks.find(week => week.weekStart === weekStart);
  if (saved) return { schemaVersion: 2, courseId: course.courseId, learnerId: card.learnerId, revision: card.revision, preferences: clone(card.preferences), ...clone(saved) };
  const level = course.levels.find(item => item.id === progress.current.activityId);
  const project = course.projects.find(item => item.id === progress.current.activityId);
  const mainGoal = level ? { kind: 'level', id: level.id } : project ? { kind: 'project-checkpoint', projectId: project.id, id: project.chapters[0]?.id || project.boss.id } : null;
  return {
    schemaVersion: 2, courseId: course.courseId, learnerId: card.learnerId, revision: card.revision, preferences: clone(card.preferences),
    weekStart, mode: mainGoal ? 'active' : 'rest', playDays: mainGoal ? card.preferences.normalPlayCount : 0,
    mainGoal, shortLevelId: level?.kind === 'interactive-lesson' && level.estimatedMinutes <= card.preferences.shortLevelMaximumMinutes ? level.id : '', note: ''
  };
}

function completedStepIds(progress, activityId, contentVersion) {
  return [...new Set(progress.attempts.filter(attempt => attempt.kind === 'level'
    && attempt.payload.levelId === activityId
    && attempt.payload.contentVersion === contentVersion
    && attempt.payload.passed).map(attempt => attempt.payload.stepId))];
}

function replacementVariant(progress, input, step) {
  if (!input.variantId || !Array.isArray(step.variants) || step.variants.length < 2) return null;
  const exposed = new Set(progress.attempts
    .filter(attempt => attempt.kind === 'level'
      && attempt.payload.levelId === input.levelId
      && attempt.payload.contentVersion === input.contentVersion
      && attempt.payload.stepId === input.stepId
      && attempt.payload.viewedFullAnswer)
    .map(attempt => attempt.payload.variantId)
    .filter(Boolean));
  if (!exposed.has(input.variantId)) return null;
  const replacement = step.variants.find(variant => !exposed.has(variant.id));
  return replacement ? learnerVariant(step, replacement) : null;
}

function activityPayload(course, progress, id) {
  const level = course.levels.find(item => item.id === id);
  if (level) {
    const rank = course.ranks.find(item => item.id === level.rankId);
    return {
      level: { ...learnerLevelContent(level.content), kind: level.kind },
      rank: learnerRank(rank), progress: clone(progress),
      completedStepIds: completedStepIds(progress, level.id, level.version),
      activityCompleted: progress.attempts.some(attempt => attempt.kind === 'level' && attempt.payload.levelId === level.id && attempt.result.levelCompleted),
      masteryRenewable: supportsMasteryChallenges(level.id)
    };
  }
  const project = course.projects.find(item => item.id === id);
  if (project) return { project: clone(project), rank: clone(course.ranks.find(item => item.id === project.rankId)), locations: clone(course.locations.filter(item => project.locationIds.includes(item.id))), props: clone(course.props.filter(item => project.propIds.includes(item.id))), progress: clone(progress) };
  throw httpError(404, '没有找到这个关卡或作品。', 'activity_not_found');
}

function parseJSONAnswer(answer) {
  if (typeof answer !== 'string') return answer;
  try { return JSON.parse(answer); } catch { return answer; }
}

function normalizedOutput(value) { return String(value ?? '').replace(/\r\n?/g, '\n'); }

function includesSubsequence(values, expected) {
  let index = 0;
  for (const value of values) if (value === expected[index]) index++;
  return index === expected.length;
}

function commandEvidenceMatches(event, expected) {
  if (event.command !== expected.command) return false;
  if (expected.args && JSON.stringify(event.rawArgs || []) !== JSON.stringify(expected.args)) return false;
  for (const field of ['pipedFrom', 'pipedTo', 'redirect', 'redirectPath']) {
    if (Object.hasOwn(expected, field) && event[field] !== expected[field]) return false;
  }
  for (const field of ['visibleOutput', 'exitStatusExpanded']) {
    if (Object.hasOwn(expected, field) && event[field] !== expected[field]) return false;
  }
  return true;
}

function programRequirementFailures(source, runtimeId, execution, requirements = {}) {
  const failures = [];
  if (runtimeId === 'c17-console') {
    const identifiers = new Set(cIdentifiers(source));
    for (const identifier of requirements.requiredIdentifiers || []) {
      if (!identifiers.has(identifier)) failures.push(`代码中需要实际使用 ${identifier}`);
    }
    return failures;
  }
  if (runtimeId !== 'linux-shell-sim') return failures;
  const trace = execution.trace || [];
  for (const command of requirements.commands || []) if (!trace.includes(command)) failures.push(`需要执行 ${command}`);
  if (requirements.commandSequence && !includesSubsequence(trace, requirements.commandSequence)) failures.push('命令执行顺序与任务要求不一致');
  const usedEvents = new Set();
  for (const expected of requirements.commandEvidence || []) {
    const index = (execution.events || []).findIndex((event, eventIndex) => !usedEvents.has(eventIndex) && commandEvidenceMatches(event, expected));
    if (index < 0) failures.push(`缺少可验证的命令步骤：${expected.command}`);
    else usedEvents.add(index);
  }
  if (requirements.cwd && execution.cwd !== requirements.cwd) failures.push(`最终目录应为 ${requirements.cwd}`);
  for (const form of requirements.pathForms || []) {
    const matched = (execution.pathEvents || []).some(event => event.form === form);
    if (!matched) failures.push(`需要实际使用路径写法 ${form === 'dot' ? './' : form === 'dotdot' ? '..' : '~'}`);
  }
  for (const [path, expected] of Object.entries(requirements.files || {})) {
    const actual = execution.state?.files?.[path];
    if (!actual) { failures.push(`需要生成文件 ${path}`); continue; }
    if (expected.mode && actual.mode !== expected.mode) failures.push(`${path} 的权限应为 ${expected.mode}`);
    if (Object.hasOwn(expected, 'content') && actual.content !== expected.content) failures.push(`${path} 的内容不符合任务要求`);
  }
  for (const path of requirements.absentFiles || []) {
    if (execution.state?.files?.[path]) failures.push(`文件 ${path} 应已被移走或删除`);
  }
  const processes = new Set((execution.state?.processes || []).map(item => item.pid));
  for (const pid of requirements.absentProcesses || []) if (processes.has(pid)) failures.push(`进程 ${pid} 仍在运行`);
  for (const pid of requirements.presentProcesses || []) if (!processes.has(pid)) failures.push(`进程 ${pid} 不应被终止`);
  return failures;
}

async function gradeProgram(source, rule, stdin = '', runtimeId = 'c17-console') {
  const cases = rule.kind === 'stdin-stdout-cases' ? rule.cases : [{ stdin, stdout: rule.expected }];
  const caseResults = [];
  for (const testCase of cases) {
    let execution;
    if (runtimeId === 'linux-shell-sim') execution = runLinuxShell(source, testCase.stdin || '');
    else if (runtimeId === 'c17-console') execution = await runC(source, testCase.stdin || '');
    else throw httpError(400, `当前在线关卡不支持运行环境 ${runtimeId}。`, 'unsupported_runtime');
    const expected = normalizedOutput(testCase.stdout);
    const actual = normalizedOutput(execution.stdout);
    const expectedExitCode = Number.isInteger(testCase.exitCode) ? testCase.exitCode : 0;
    const requirements = { ...(rule.requirements || {}), ...(testCase.requirements || {}) };
    const requirementFailures = execution.phase === 'run' ? programRequirementFailures(source, runtimeId, execution, requirements) : [];
    const passed = execution.phase === 'run' && !execution.timedOut && execution.exitCode === expectedExitCode && actual === expected && requirementFailures.length === 0;
    caseResults.push({ stdin: testCase.stdin || '', expected, actual, stderr: execution.stderr, phase: execution.phase, exitCode: execution.exitCode, expectedExitCode, timedOut: execution.timedOut === true, requirementFailures, passed });
    if (execution.phase === 'compile' || execution.timedOut || execution.outputLimited) break;
  }
  const passed = caseResults.length === cases.length && caseResults.every(item => item.passed);
  const firstFailure = caseResults.find(item => !item.passed);
  return {
    passed,
    feedback: {
      kind: runtimeId === 'linux-shell-sim' ? 'terminal' : 'program', message: passed ? `全部 ${cases.length} 组检查通过。` : firstFailure?.phase === 'compile' ? '代码还没有编译通过，先处理第一条编译信息。' : firstFailure?.timedOut ? '程序没有在限定时间内结束。' : firstFailure?.requirementFailures?.length ? `输出已经接近目标，但实现证据还不完整：${firstFailure.requirementFailures.join('；')}。` : runtimeId === 'linux-shell-sim' ? '命令执行结果与目标还不一致。' : '实际输出与目标还不一致。',
      actualOutput: firstFailure?.actual ?? caseResults.at(-1)?.actual ?? '', expectedOutput: firstFailure?.expected ?? '', stderr: firstFailure?.stderr || '', cases: caseResults
    }
  };
}

export async function gradeLevel(course, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw httpError(400, '关卡提交须为对象。');
  for (const required of ['requestId', 'levelId', 'contentVersion', 'stepId', 'action', 'answer', 'hintLevel', 'viewedFullAnswer']) if (!(required in raw)) throw httpError(400, `关卡提交缺少 ${required}。`);
  if (!safeId(raw.requestId) || !safeId(raw.levelId) || !safeId(raw.stepId)) throw httpError(400, '关卡、步骤或提交编号无效。');
  const level = course.levels.find(item => item.id === raw.levelId);
  if (!level?.content) throw httpError(404, '关卡不存在或详情未加载。', 'level_not_found');
  if (raw.contentVersion !== level.version) throw httpError(409, '关卡内容已经更新，请重新读取。', 'content_version_conflict');
  const steps = level.kind === 'rank-boss' ? level.content.checkpoints : level.content.steps;
  const step = steps.find(item => item.id === raw.stepId);
  if (!step) throw httpError(404, '步骤不存在。', 'step_not_found');
  const variantId = typeof raw.variantId === 'string' ? raw.variantId : '';
  const variant = variantId ? step.variants?.find(item => item.id === variantId) : null;
  if (variantId && !variant) throw httpError(400, '变式不属于当前步骤。');
  const answer = typeof raw.answer === 'string' ? raw.answer : JSON.stringify(raw.answer ?? '');
  const rule = variant?.grader || step.grader || step.evaluator;
  let graded;
  if (raw.action === 'reveal') {
    if (step.type !== 'independent-variation' || !variant || raw.viewedFullAnswer !== true || Number(raw.hintLevel) !== 3) throw httpError(400, '只有完成三层提示的独立变式可以记录完整答案。', 'invalid_reveal');
    graded = { passed: false, feedback: { kind: 'reveal', message: '完整思路查看状态已记录。', actualOutput: '', expectedOutput: '' } };
  } else if (rule?.kind === 'exact-order') {
    const actual = parseJSONAnswer(answer);
    const passed = Array.isArray(actual) && same(actual, rule.expected);
    graded = { passed, feedback: { kind: 'answer', message: passed ? '顺序判断正确。' : '先保留这次预测，再对照运行结果。', actualOutput: Array.isArray(actual) ? actual.join(' → ') : answer, expectedOutput: rule.expected.join(' → ') } };
  } else if (rule?.kind === 'object-exact' || rule?.kind === 'mapping-exact') {
    const actual = parseJSONAnswer(answer);
    const passed = actual !== null && typeof actual === 'object' && !Array.isArray(actual) && same(actual, rule.expected);
    graded = {
      passed,
      feedback: {
        kind: 'answer',
        message: passed ? '每一项对应关系都正确。' : '还有一项对应关系与实际执行不同。',
        actualOutput: typeof actual === 'object' ? JSON.stringify(actual, null, 2) : answer,
        expectedOutput: JSON.stringify(rule.expected, null, 2)
      }
    };
  } else if (rule?.kind === 'choice') {
    const actual = Number(parseJSONAnswer(answer));
    const passed = actual === rule.expectedIndex;
    graded = { passed, feedback: { kind: 'answer', message: passed ? '选择正确。' : '这个预测与实际结果不同，运行后再找原因。', actualOutput: String(actual), expectedOutput: String(rule.expectedIndex) } };
  } else if (rule?.kind === 'number-exact') {
    const actual = Number(String(parseJSONAnswer(answer)).trim());
    const passed = Number.isFinite(actual) && actual === rule.expected;
    graded = { passed, feedback: { kind: 'answer', message: passed ? '数值判断正确。' : '重新逐步代入一次，观察每次状态变化。', actualOutput: String(actual), expectedOutput: String(rule.expected) } };
  } else if (['stdout-exact', 'stdin-stdout-cases'].includes(rule?.kind)) {
    const starterFiles = variant?.starterFiles || step.starterFiles || {};
    const starter = starterFiles['main.c'] || starterFiles['session.sh'] || Object.values(starterFiles)[0];
    const source = step.type === 'run-observe' ? starter : answer;
    if (!source) throw httpError(400, step.runtimeId === 'linux-shell-sim' ? '这一终端步骤没有收到命令。' : '这一代码步骤没有收到 C 源码。', 'source_required');
    graded = await gradeProgram(source, rule, step.stdin || '', step.runtimeId);
  } else {
    const minimum = Number(step.answerPolicy?.minimumCharacters || 8);
    const passed = [...answer.trim()].length >= minimum;
    graded = { passed, feedback: { kind: 'explanation', message: passed ? '解释已经保存。下一步用新的代码变化检验这个理解。' : `请至少用 ${minimum} 个字符说清观察到的现象和原因。`, actualOutput: answer, expectedOutput: '' } };
  }
  const finalBossStep = level.kind === 'rank-boss' && steps.at(-1)?.id === step.id;
  const independent = !raw.viewedFullAnswer && (step.type === 'independent-variation' || step.kind === 'independent-transfer' || finalBossStep);
  graded.feedback.passed = graded.passed;
  return {
    input: {
      requestId: raw.requestId, levelId: level.id, contentVersion: level.version, stepId: step.id, variantId,
      action: ['run', 'check', 'submit', 'reveal'].includes(raw.action) ? raw.action : 'check', answer,
      hintLevel: Number(raw.hintLevel), viewedFullAnswer: raw.viewedFullAnswer === true, passed: graded.passed, independent
    },
    feedback: graded.feedback, level, step, variant
  };
}

function unlockAchievements(course, progress, input, result, attemptId, submittedAt, step) {
  const unlocked = [];
  function unlock(id) {
    if (progress.achievementWall.earned.some(item => item.achievementId === id)) return;
    const definition = course.achievements.find(item => item.id === id); if (!definition) return;
    progress.achievementWall.earned.push({ achievementId: id, earnedAt: submittedAt, attemptId });
    progress.achievementWall.visibleLockedIds = progress.achievementWall.visibleLockedIds.filter(value => value !== id);
    if (definition.hidden) progress.achievementWall.hiddenCount = Math.max(0, progress.achievementWall.hiddenCount - 1);
    progress.awardLedger.push({ key: `achievement:${id}`, kind: 'achievement', rankId: course.levels.find(item => item.id === input.levelId).rankId, activityId: input.levelId, sourceId: id, amount: 1, title: definition.title, attemptId, earnedAt: submittedAt });
    unlocked.push({ id, title: definition.title });
  }
  if (result.starAwarded && progress.attempts.some(item => item.kind === 'level' && item.payload.levelId === input.levelId && item.payload.viewedFullAnswer)) unlock('achievement-return-after-solution');
  if (input.passed && step.type === 'explanation' && input.answer.trim().length >= 20) unlock('achievement-error-explainer');
  return unlocked;
}

export async function startServer({ root = ROOT, assetRoot = ROOT, host = '127.0.0.1', port = 3000, learnerEmail = process.env.LEARNER_GIT_EMAIL, allowedHostnames = process.env.ALLOWED_HOSTS, lock = true, storeOptions = {} } = {}) {
  const store = new Store(root, storeOptions);
  const release = lock ? await acquireLock(root) : async () => {};
  const hosts = allowedHosts(host, allowedHostnames);
  const codeReader = createProjectCodeReader(root);

  async function readState() {
    const rawCourse = await store.read('data/course.json');
    const files = [...(rawCourse.levels || []), ...(rawCourse.projects || [])].map(item => safeDetailPath(item.file, item.id));
    const details = await Promise.all(files.map(file => store.read(file)));
    let course, progress, weekCard;
    try { course = sanitizeCourse(rawCourse, details); }
    catch (error) { throw httpError(500, `data/course.json 或 data/levels 校验失败：${error.message}`, 'corrupt_data'); }
    for (const project of course.projects) if (project.codeDelivery) await codeReader.readPublished(project);
    try { progress = sanitizeProgress(course, await store.read('data/progress.json')); }
    catch (error) { throw httpError(500, `data/progress.json 校验失败：${error.message}`, 'corrupt_data'); }
    try { weekCard = sanitizeWeekCard(course, await store.read('data/week-card.json')); }
    catch (error) { throw httpError(500, `data/week-card.json 校验失败：${error.message}`, 'corrupt_data'); }
    return { rawCourse, course, progress, weekCard, details, versions: { course: etag(course), progress: etag(progress), weekCard: etag(weekCard) } };
  }

  async function staticFile(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, '此资源不支持该方法。');
    let base, relative;
    if (pathname.startsWith('/shared/')) {
      if (pathname !== '/shared/park-domain.mjs') throw httpError(404, '没有找到该文件。');
      base = join(assetRoot, 'shared'); relative = 'park-domain.mjs';
    } else { base = join(assetRoot, 'public'); relative = pathname === '/' ? 'index.html' : pathname.slice(1); }
    if (!relative || relative.split('/').some(part => part.startsWith('.') || part === '..') || relative.includes('\\') || relative.includes('\0')) throw httpError(404, '没有找到该文件。');
    const requested = resolve(base, relative);
    if (!requested.startsWith(`${resolve(base)}${sep}`)) throw httpError(404, '没有找到该文件。');
    let file;
    try {
      file = await realpath(requested);
      if (!file.startsWith(`${await realpath(base)}${sep}`) || !(await stat(file)).isFile()) throw new Error('not-file');
    } catch { throw httpError(404, '没有找到该文件。'); }
    const content = await readFile(file);
    if (pathname === '/report.html') res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': pathname.startsWith('/assets/park/') ? 'public, max-age=3600' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  }

  async function writeCourse(input, current) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw httpError(400, '课程须为对象。');
    const nextIndex = clone(input);
    const currentLevels = new Map(current.course.levels.map(level => [level.id, level]));
    const details = [];
    nextIndex.levels = (nextIndex.levels || []).map(level => {
      const value = clone(level), old = currentLevels.get(value.id), content = value.content || old?.content;
      delete value.content;
      if (!content) throw httpError(400, `关卡 ${value.id} 缺少详情。`);
      safeDetailPath(value.file, value.id);
      const changed = !old || !same(content, old.content);
      const version = changed ? Math.max(Number(value.version || 0), Number(old?.version || 0) + 1) : Number(old.version);
      value.version = version; content.version = version; details.push(content);
      return value;
    });
    const currentProjects = new Map(current.course.projects.map(project => [project.id, project]));
    nextIndex.projects = (nextIndex.projects || []).map(project => {
      const value = clone(project), old = currentProjects.get(value.id);
      safeDetailPath(value.file, value.id);
      const compare = item => { const copy = clone(item); delete copy.version; return copy; };
      value.version = !old || !same(compare(value), compare(old)) ? Math.max(Number(value.version || 0), Number(old?.version || 0) + 1) : Number(old.version);
      details.push(clone(value));
      return value;
    });
    nextIndex.publishedRevision = current.rawCourse.publishedRevision + 1;
    const hydrated = sanitizeCourse(nextIndex, details);
    sanitizeProgress(hydrated, current.progress);
    sanitizeWeekCard(hydrated, current.weekCard);
    const known = new Set([...hydrated.levels.map(item => item.id), ...hydrated.projects.map(item => item.id)]);
    for (const attempt of current.progress.attempts) {
      const activityId = attempt.kind === 'level' ? attempt.payload.levelId : attempt.payload.projectId;
      if (!known.has(activityId)) throw httpError(400, `已有学习记录引用 ${activityId}，不能直接删除；请保留稳定编号。`, 'referenced_activity');
    }
    for (const attempt of current.progress.conceptAttempts || []) {
      if (!known.has(attempt.payload.projectId)) throw httpError(400, `已有概念理解记录引用 ${attempt.payload.projectId}，不能直接删除；请保留稳定编号。`, 'referenced_activity');
    }
    for (const project of hydrated.projects) {
      if (project.codeDelivery) await codeReader.validateCandidate(project);
    }
    await store.writeDataBatch([
      ...details.map(detail => ({
        relative: safeDetailPath(detail.file || `levels/${detail.id}.json`, detail.id),
        value: detail
      })),
      { relative: 'data/course.json', value: nextIndex }
    ]);
    return hydrated;
  }

  try { await store.recoverDataSwap(readState); }
  catch (error) { await release(); throw error; }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const origin = validateHost(req, server, hosts);
      const url = new URL(req.url, origin);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw httpError(400, '网址编码无效。'); }
      if (pathname === '/play.html' && url.searchParams.get('preview') === 'workshop') {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
      }
      if (!pathname.startsWith('/api/')) return await staticFile(req, res, pathname);
      const method = req.method || 'GET';
      if (!['GET', 'POST', 'PUT'].includes(method)) throw httpError(405, '不支持该方法。');
      if (method !== 'GET' && req.headers.origin !== origin) throw httpError(403, '只允许同源页面写入。', 'origin_rejected');

      if (pathname === '/api/admin/preview/attempt' && method === 'POST') {
        return json(res, 200, await evaluateCoursePreview(await readBody(req), gradeLevel));
      }

      if (pathname === '/api/admin/history' && method === 'GET') {
        return json(res, 200, await getGitHistory({ root, learnerEmail, kind: url.searchParams.get('kind') || 'all', offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 20) }));
      }

      if (pathname === '/api/play/home' && method === 'GET') {
        const state = await store.run(readState);
        const derived = progressSummary(state.course, state.progress);
        const currentActivity = withMasteryChallenges(state.course, state.progress).levels.find(item => item.id === state.progress.current.activityId);
        const currentProject = state.course.projects.find(item => item.id === state.progress.current.activityId);
        const currentLevel = currentActivity ? { ...learnerLevelContent(currentActivity.content), kind: currentActivity.kind } : currentProject ? clone(currentProject) : null;
        const recentRewardEntry = [...state.progress.awardLedger].reverse().find(item => item.kind !== 'xp' && item.kind !== 'star') || null;
        return json(res, 200, { course: publicCourse(state.course), progress: state.progress, summary: derived, learner: state.progress.learner, weekCard: currentWeekView(state.course, state.progress, state.weekCard), currentLevel, recentReward: recentRewardEntry }, { course: state.versions.course, progress: state.versions.progress, weekCard: state.versions.weekCard });
      }

      const activityRoute = pathname.match(/^\/api\/play\/levels\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})$/);
      if (activityRoute && method === 'GET') {
        const state = await store.run(readState);
        return json(res, 200, activityPayload(withMasteryChallenges(state.course, state.progress), state.progress, activityRoute[1]), state.progress);
      }

      const projectCodeRoute = pathname.match(/^\/api\/play\/projects\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})\/code-package$/);
      if (projectCodeRoute && method === 'GET') {
        const state = await store.run(readState);
        const project = state.course.projects.find(item => item.id === projectCodeRoute[1]);
        if (!project) throw httpError(404, '没有找到这个作品。', 'activity_not_found');
        const codePackage = await codeReader.readPublished(project);
        return json(res, 200, { codePackage, packageSha256: project.codeDelivery.packageSha256 }, project.codeDelivery.packageSha256);
      }

      if (pathname === '/api/play/attempts' && method === 'POST') {
        const raw = await readBody(req);
        const snapshot = await store.run(readState);
        const graded = await gradeLevel(withMasteryChallenges(snapshot.course, snapshot.progress, raw), raw);
        const submittedAt = new Date().toISOString(), attemptId = randomUUID();
        return await store.run(async () => {
          const state = await readState();
          const outcome = submitAttempt(withMasteryChallenges(state.course, state.progress, raw), state.progress, graded.input, { id: attemptId, submittedAt });
          let achievements = [];
          if (!outcome.result.replayed) {
            achievements = unlockAchievements(state.course, outcome.progress, graded.input, outcome.result, attemptId, submittedAt, graded.step);
            sanitizeProgress(state.course, outcome.progress);
            await store.write('data/progress.json', outcome.progress);
          }
          const pointer = outcome.progress.current;
          const nextLevel = state.course.levels.find(item => item.id === pointer.activityId);
          const updatedStep = withMasteryChallenges(state.course, outcome.progress).levels.find(level => level.id === graded.level.id)?.content?.steps?.find(step => step.id === graded.step.id) || graded.step;
          const replacement = replacementVariant(outcome.progress, graded.input, updatedStep);
          const reveal = graded.input.action === 'reveal'
            ? { variantId: graded.input.variantId, fullSolution: authoredFullSolution(graded.step, graded.variant) }
            : null;
          return json(res, 200, {
            result: outcome.result,
            progress: outcome.progress,
            feedback: { ...graded.feedback, passed: graded.input.passed },
            achievements,
            next: { activityId: pointer.activityId, stepId: pointer.stepId, levelTitle: nextLevel?.title || '', replacementVariant: replacement },
            ...(reveal ? { reveal } : {})
          }, outcome.progress);
        });
      }

      if (pathname === '/api/play/project-attempts' && method === 'POST') {
        const raw = await readBody(req);
        return await store.run(async () => {
          const state = await readState();
          const input = { ...raw, passed: raw.passed === true, independent: raw.independent === true, viewedFullAnswer: raw.viewedFullAnswer === true, hintLevel: Number(raw.hintLevel || 0), performancePoints: Number(raw.performancePoints || 0) };
          const outcome = submitProjectCheckpoint(state.course, state.progress, input, { id: randomUUID(), submittedAt: new Date().toISOString() });
          if (!outcome.result.replayed) await store.write('data/progress.json', outcome.progress);
          return json(res, 200, outcome, outcome.progress);
        });
      }

      if (pathname === '/api/play/project-concept-attempts' && method === 'POST') {
        const raw = await readBody(req);
        return await store.run(async () => {
          const state = await readState();
          const outcome = submitProjectConceptCheck(state.course, state.progress, raw, { id: randomUUID(), submittedAt: new Date().toISOString() });
          if (!outcome.result.replayed) await store.write('data/progress.json', outcome.progress);
          return json(res, 200, outcome, outcome.progress);
        });
      }

      if (pathname === '/api/play/week-card' && method === 'PUT') {
        const raw = await readBody(req);
        return await store.run(async () => {
          const state = await readState();
          if (!raw || typeof raw !== 'object' || raw.schemaVersion !== 2 || raw.courseId !== state.course.courseId || raw.learnerId !== state.weekCard.learnerId) throw httpError(400, '周卡版本、课程或学习者不匹配。');
          const requestId = `week-${fingerprint(raw).slice(0, 24)}`;
          const prior = state.weekCard.receipts.find(item => item.requestId === requestId);
          if (prior) return json(res, 200, { weekCard: { ...prior.payload, schemaVersion: 2, courseId: state.course.courseId, learnerId: state.weekCard.learnerId, revision: state.weekCard.revision, preferences: state.weekCard.preferences }, replayed: true }, state.weekCard);
          if (Number(raw.revision) !== state.weekCard.revision) throw httpError(412, '本周游玩卡已由另一个页面更新。', 'version_conflict');
          const entry = { weekStart: raw.weekStart, mode: raw.mode, playDays: raw.mode === 'rest' ? 0 : raw.playDays, mainGoal: raw.mode === 'rest' ? null : raw.mainGoal, shortLevelId: raw.mode === 'rest' ? '' : raw.shortLevelId, note: raw.note || '', updatedAt: new Date().toISOString() };
          const next = clone(state.weekCard);
          const index = next.weeks.findIndex(item => item.weekStart === entry.weekStart);
          if (index >= 0) next.weeks[index] = entry; else next.weeks.push(entry);
          next.receipts.push({ requestId, payload: clone(entry), updatedAt: entry.updatedAt });
          next.revision++;
          const validated = sanitizeWeekCard(state.course, next);
          await store.write('data/week-card.json', validated);
          return json(res, 200, { weekCard: { ...entry, schemaVersion: 2, courseId: state.course.courseId, learnerId: validated.learnerId, revision: validated.revision, preferences: validated.preferences }, replayed: false }, validated);
        });
      }

      if (pathname === '/api/admin/state' && method === 'GET') {
        const state = await store.run(readState);
        return json(res, 200, { course: state.course, progress: state.progress, summary: progressSummary(state.course, state.progress), weekCard: currentWeekView(state.course, state.progress, state.weekCard), weekCardHistory: state.weekCard, versions: state.versions }, { course: state.versions.course, progress: state.versions.progress, weekCard: state.versions.weekCard });
      }

      if (pathname === '/api/admin/course') {
        if (method === 'GET') { const state = await store.run(readState); return json(res, 200, state.course, state.course); }
        if (method === 'PUT') {
          const input = await readBody(req);
          return await store.run(async () => {
            const current = await readState();
            requireMatch(current.versions.course, req.headers['if-match']);
            const course = await writeCourse(input, current);
            return json(res, 200, { course }, course);
          });
        }
      }

      if (pathname === '/api/admin/export' && method === 'GET') {
        const state = await store.run(readState);
        return json(res, 200, { schemaVersion: 2, exportedAt: new Date().toISOString(), course: state.rawCourse, levelDetails: state.details, progress: state.progress, weekCard: state.weekCard });
      }
      throw httpError(404, '没有找到该接口或不支持此方法。');
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.message || '服务处理失败，未确认保存。', code: error.code || (error.status === 409 ? 'conflict' : 'request_failed'), ...(error.details ? { details: error.details } : {}) });
      else if (!res.writableEnded) res.end();
    }
  });

  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); }); }
  catch (error) { await release(); throw error; }
  const address = server.address();
  let closed = false;
  return {
    server, store, url: `http://${host === '::' || host === '::1' ? `[${host}]` : host}:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      await store.queue; await release();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    try { process.loadEnvFile(join(ROOT, '.env.local')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const args = process.argv.slice(2);
    const options = { host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000) };
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--host' && args[index + 1]) options.host = args[++index];
      else if (args[index] === '--port' && args[index + 1]) options.port = Number(args[++index]);
      else throw new Error('用法：node server.mjs [--host 127.0.0.1] [--port 3000]');
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('PORT 须为 0–65535 的整数。');
    const app = await startServer(options);
    console.log(`蛋仔岛大厅：${app.url}/learner.html`);
    console.log(`岛务管理处：${app.url}/admin.html`);
    console.log(`段位地图：${app.url}/plan.html`);
    console.log('保存会写入 data/；Git 提交和推送仍由你决定。');
    if (options.host === '0.0.0.0' || options.host === '::') console.log('局域网已开启：可访问此服务的人拥有相同读写能力。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
