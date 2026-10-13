import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, copyFile, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.mjs';
import { weekStartFor } from '../shared/schedule.mjs';

const PROJECT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_URL = new URL('../server.mjs', import.meta.url).href;
const exec = promisify(execFile);
const clone = value => structuredClone(value);
let sequence = 0;
const nextId = prefix => prefix + '-' + (++sequence);

async function fixture(t, { start = true, storeOptions = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'study-server-'));
  const running = [];
  t.after(async () => { for (const app of running) await app.close(); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'data'), { recursive: true });
  await Promise.all(['curriculum', 'schedule'].map(name => copyFile(join(PROJECT, 'data', name + '.json'), join(root, 'data', name + '.json'))));
  const result = { root, app: null, async start(options = {}) { const app = await startServer({ root, assetRoot: PROJECT, host: '127.0.0.1', port: 0, learnerEmail: 'mahoo-pig@qq.com', storeOptions, ...options }); running.push(app); result.app = app; return app; } };
  if (start) await result.start();
  return result;
}
function request(app, path, { method = 'GET', data, raw, etag, course, origin = true, host, contentType = 'application/json' } = {}) {
  const target = new URL(app.url), headers = {};
  const payload = raw === undefined ? (data === undefined ? undefined : JSON.stringify(data)) : raw;
  if (method !== 'GET' && origin !== false) headers.Origin = origin === true ? app.url : origin;
  if (payload !== undefined) { headers['Content-Type'] = contentType; headers['Content-Length'] = Buffer.byteLength(payload); }
  if (etag !== undefined) headers['If-Match'] = etag;
  if (course !== undefined) headers['X-Curriculum-Version'] = course;
  if (host !== undefined) headers.Host = host;
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: target.hostname, port: target.port, method, path, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { const text = Buffer.concat(chunks).toString(); let body; try { body = JSON.parse(text); } catch (_) { body = text; } resolve({ status: res.statusCode, headers: res.headers, etag: res.headers.etag, body, text }); });
    });
    req.setTimeout(10000, () => req.destroy(new Error('HTTP test timeout')));
    req.on('error', reject); if (payload !== undefined) req.write(payload); req.end();
  });
}
function expect(response, status) { assert.equal(response.status, status, response.text); return response; }
function error(response, status, code) { expect(response, status); assert.equal(typeof response.body.error, 'string'); assert.equal(typeof response.body.code, 'string'); if (code) assert.equal(response.body.code, code); return response; }
async function initial(app) {
  const catalog = expect(await request(app, '/api/catalog'), 200);
  const unit = catalog.body.units.find(unit => !unit.archived);
  const doc = expect(await request(app, '/api/admin/units/' + unit.id), 200);
  return { catalog, unit, doc, route: '/api/admin/units/' + unit.id };
}
function record(unit, overrides = {}) {
  return { requestId: nextId('record'), taskId: unit.acceptanceTaskId, assessmentVersion: unit.assessmentVersion, date: '2026-10-13', minutes: 90, outcome: 'passed', result: '独立构造正常、空输入与边界用例并复测。', evidence: 'tests/checks.md / 可复现输出', blocker: '', next: '', ai: 'none', aiCheck: '', answers: [], correctionOf: '', scheduleItemId: '', ...overrides };
}
function draft(unit, overrides = {}) { const { requestId, taskId, correctionOf, scheduleItemId, ...fields } = record(unit); return { ...fields, date: '', minutes: '', result: '', evidence: '', outcome: 'practice', ...overrides }; }
function assessment(unit) { return { assessment: { version: unit.assessmentVersion, checks: Object.fromEntries(unit.criteria.map(criterion => [criterion.id, true])) } }; }
function options(method, data, doc, catalog) { return { method, data, etag: doc.etag, course: catalog.etag }; }

test('读取空档案不落盘；同 ETag 的并发修改只有一个成功，另一个 412 且不覆盖', async t => {
  const f = await fixture(t), { catalog, unit, doc, route } = await initial(f.app);
  await assert.rejects(stat(join(f.root, 'data/units', unit.id + '.json')), { code: 'ENOENT' });
  const responses = await Promise.all(['第一次页面修改', '第二次页面修改'].map(reflection => request(f.app, route, options('PATCH', { reflection }, doc, catalog))));
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 412]);
  const winner = responses.find(response => response.status === 200); error(responses.find(response => response.status === 412), 412, 'version_conflict');
  const saved = expect(await request(f.app, route), 200);
  assert.equal(saved.body.reflection, winner.body.reflection); assert.equal(saved.etag, winner.etag);
  assert.deepEqual(JSON.parse(await readFile(join(f.root, 'data/units', unit.id + '.json'), 'utf8')), saved.body);
});

test('稳定 requestId 并发与旧 ETag 重试仅写一次；不同内容 409，重启仍持久', async t => {
  const f = await fixture(t), { catalog, unit, doc, route } = await initial(f.app), input = record(unit);
  const responses = await Promise.all([request(f.app, route + '/records', options('POST', input, doc, catalog)), request(f.app, route + '/records', options('POST', input, doc, catalog))]);
  responses.forEach(response => expect(response, 200)); assert.equal(responses[0].body.records.length, 1); assert.equal(responses[1].body.records.length, 1);
  const retry = expect(await request(f.app, route + '/records', options('POST', input, doc, catalog)), 200);
  assert.equal(retry.body.records.length, 1); assert.equal(retry.body.records[0].id, responses[0].body.records[0].id);
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const equivalentRetry = expect(await request(f.app, route + '/records', options('POST', reordered, doc, catalog)), 200);
  assert.equal(equivalentRetry.body.records[0].id, retry.body.records[0].id);
  error(await request(f.app, route + '/records', options('POST', { ...input, minutes: 91 }, doc, catalog)), 409);
  await f.app.close(); await f.start();
  const restored = expect(await request(f.app, route), 200); assert.deepEqual(restored.body, retry.body);
  const backup = expect(await request(f.app, '/api/admin/export'), 200);
  assert.equal(backup.body.units.find(value => value.unitId === unit.id).records.length, 1);
  assert.equal(backup.body.curriculum.units.length, catalog.body.units.length); assert.ok(backup.body.exportedAt);
});

test('课程修改与旧版记录交错，不把旧证据当作新版验收；稳定重试仍返回已有历史', async t => {
  const f = await fixture(t), { catalog, unit, doc, route } = await initial(f.app);
  const input = record(unit), change = clone(catalog.body); change.units.find(value => value.id === unit.id).criteria[0].text += '；另测一个新边界';
  const [saved, edited] = await Promise.all([
    request(f.app, route + '/records', options('POST', input, doc, catalog)),
    request(f.app, '/api/admin/curriculum', { method: 'PUT', data: change, etag: catalog.etag })
  ]);
  expect(edited, 200); assert.ok([200, 412].includes(saved.status), saved.text);
  const current = expect(await request(f.app, '/api/catalog'), 200), currentUnit = current.body.units.find(value => value.id === unit.id);
  assert.equal(currentUnit.assessmentVersion, unit.assessmentVersion + 1);
  const currentDoc = expect(await request(f.app, route), 200);
  error(await request(f.app, route + '/records', options('POST', { ...input, requestId: nextId('old-version') }, currentDoc, catalog)), 412, 'version_conflict');
  error(await request(f.app, route + '/records', options('POST', { ...input, requestId: nextId('stale-version') }, currentDoc, current)), 409);
  const overview = expect(await request(f.app, '/api/admin/overview'), 200);
  assert.notEqual(overview.body.units.find(value => value.id === unit.id).status, 'accepted');
  if (saved.status === 200) {
    const retried = expect(await request(f.app, route + '/records', options('POST', input, doc, catalog)), 200);
    assert.equal(retried.body.records[0].assessmentVersion, unit.assessmentVersion);
    assert.equal(retried.body.records[0].criteriaSnapshot[0].text, unit.criteria[0].text);
  }
  const newEvidence = expect(await request(f.app, route + '/records', options('POST', record(currentUnit), currentDoc, current)), 200);
  expect(await request(f.app, route, options('PATCH', assessment(currentUnit), newEvidence, current)), 200);
  const accepted = expect(await request(f.app, '/api/admin/overview'), 200);
  assert.equal(accepted.body.units.find(value => value.id === unit.id).status, 'accepted');
});

test('原子写入在 rename 前失败不假成功，旧 JSON 和 ETag 完整，后续保存可恢复', async t => {
  let failWrite = false;
  const f = await fixture(t, { storeOptions: { beforeRename({ relative }) { if (failWrite && relative.startsWith('data/units/')) throw Object.assign(new Error('injected before rename'), { code: 'EIO' }); } } });
  const { catalog, unit, doc, route } = await initial(f.app);
  const baseline = expect(await request(f.app, route, options('PATCH', { reflection: '已确认落盘的内容' }, doc, catalog)), 200);
  const path = join(f.root, 'data/units', unit.id + '.json'), bytes = await readFile(path, 'utf8'); failWrite = true;
  error(await request(f.app, route, options('PATCH', { reflection: '不应假成功的新内容' }, baseline, catalog)), 500, 'storage_error');
  assert.equal(await readFile(path, 'utf8'), bytes);
  const reread = expect(await request(f.app, route), 200); assert.equal(reread.etag, baseline.etag); assert.equal(reread.body.reflection, baseline.body.reflection);
  assert.deepEqual(await readdir(join(f.root, 'data/units')), [unit.id + '.json']);
  failWrite = false;
  expect(await request(f.app, route, options('PATCH', { reflection: '恢复后保存成功' }, baseline, catalog)), 200);
});

test('损坏 JSON 阻止启动并保留原文件；释放失败启动锁后可修复重启', async t => {
  const f = await fixture(t, { start: false }), file = join(f.root, 'data/schedule.json'), valid = await readFile(file, 'utf8');
  await writeFile(file, '{broken schedule');
  await assert.rejects(f.start(), error => error.code === 'corrupt_data'); assert.equal(await readFile(file, 'utf8'), '{broken schedule');
  await assert.rejects(stat(join(f.root, '.local/server.lock')), { code: 'ENOENT' });
  await writeFile(file, valid); await f.start(); expect(await request(f.app, '/api/catalog'), 200);
});

test('同数据目录第二进程拒绝运行，不抢占锁；首进程停止后可重启', async t => {
  const f = await fixture(t);
  const code = `import {startServer} from ${JSON.stringify(SERVER_URL)};try{const a=await startServer({root:${JSON.stringify(f.root)},assetRoot:${JSON.stringify(PROJECT)},host:'127.0.0.1',port:0});await a.close();console.log('UNEXPECTED_STARTED');process.exitCode=2;}catch(e){console.log(e.message);}`;
  const result = await exec(process.execPath, ['--input-type=module', '-e', code], { timeout: 6000 });
  assert.match(result.stdout, /已有运行进程/); assert.ok(!result.stdout.includes('UNEXPECTED_STARTED'));
  expect(await request(f.app, '/api/catalog'), 200); await f.app.close(); await f.start(); expect(await request(f.app, '/api/catalog'), 200);
});

test('周安排文件丢失时拒绝读取和启动，不伪造空安排或覆盖原历史', async t => {
  const f = await fixture(t), path = join(f.root, 'data/schedule.json');
  const original = await readFile(path, 'utf8');
  await rm(path);
  const missing = await request(f.app, '/api/admin/schedule');
  error(missing, 500, 'corrupt_data');
  assert.match(missing.body.error, /data\/schedule\.json/);
  await assert.rejects(stat(path), { code: 'ENOENT' });
  await f.app.close();
  await assert.rejects(f.start(), e => e.code === 'corrupt_data');
  await writeFile(path, original);
  await f.start();
  assert.deepEqual(expect(await request(f.app, '/api/admin/schedule'), 200).body, JSON.parse(original));
});

test('Host/Origin/写入类型/版本校验生效，数据和 Git 路径不作为静态文件暴露', async t => {
  const f = await fixture(t), { catalog, doc, route } = await initial(f.app);
  error(await request(f.app, '/api/catalog', { host: 'attacker.invalid:' + new URL(f.app.url).port }), 403);
  for (const origin of [false, 'http://attacker.invalid', 'null']) error(await request(f.app, route, { ...options('PATCH', { reflection: '不应写入' }, doc, catalog), origin }), 403, 'origin_rejected');
  error(await request(f.app, route, { ...options('PATCH', { reflection: '不应写入' }, doc, catalog), contentType: 'text/plain' }), 415);
  error(await request(f.app, route, { method: 'PATCH', data: { reflection: '无版本' } }), 428, 'version_required');
  error(await request(f.app, route, { method: 'PATCH', data: { reflection: '缺课程版本' }, etag: doc.etag }), 428, 'version_required');
  error(await request(f.app, route, { ...options('PATCH', null, doc, catalog), raw: '{broken' }), 400);
  for (const path of ['/data/curriculum.json', '/data/schedule.json', '/.git/config', '/lib/store.mjs', '/%2e%2e%2fdata/curriculum.json', '/..%5Cdata%5Ccurriculum.json', '/shared/../data/curriculum.json']) {
    const result = await request(f.app, path); assert.ok([400, 404].includes(result.status), path + ': ' + result.status); assert.ok(!result.text.includes('"schemaVersion"'));
  }
  const history = expect(await request(f.app, '/api/admin/history'), 200); assert.equal(history.body.status, 'not-repository');
  assert.deepEqual((await request(f.app, route)).body, doc.body);
});

test('安排预览不写入；单位档案变化使预览过期；重新预览后应用、旧版本重试与冲突判断正确', async t => {
  const f = await fixture(t), { catalog, unit, doc, route } = await initial(f.app);
  const schedule = expect(await request(f.app, '/api/admin/schedule'), 200), file = join(f.root, 'data/schedule.json'), original = await readFile(file, 'utf8');
  const weekStart = weekStartFor('2099-01-12'), requestId = nextId('plan');
  const input = { requestId, weekStart, reason: '先集中解决当前任务', slots: [{ id: 'future-slot', date: weekStart, start: '19:00', minutes: 180, bufferMinutes: 30 }], items: [{ id: 'fragment-one', taskId: unit.tasks[0].id, goal: '完成一个输入边界复测', estimatedMinutes: 150, continuedFromItemId: '' }, { id: 'fragment-two', taskId: unit.tasks[1].id, goal: '拆开一个小功能', estimatedMinutes: 60, continuedFromItemId: '' }] };
  const preview = expect(await request(f.app, '/api/admin/schedule/preview', { method: 'POST', data: input, etag: schedule.etag }), 200);
  assert.equal(preview.body.plannedMinutes, 150); assert.equal(preview.body.plan.unassigned.length, 1); assert.equal(await readFile(file, 'utf8'), original);
  expect(await request(f.app, route, options('PATCH', { reflection: '预览后有新记录上下文' }, doc, catalog)), 200);
  error(await request(f.app, '/api/admin/schedule/apply', { method: 'POST', data: { requestId, preview: preview.body }, etag: schedule.etag }), 409, 'preview_stale');
  const refreshed = expect(await request(f.app, '/api/admin/schedule/preview', { method: 'POST', data: input, etag: schedule.etag }), 200);
  const apply = { requestId, preview: refreshed.body };
  const applied = expect(await request(f.app, '/api/admin/schedule/apply', { method: 'POST', data: apply, etag: schedule.etag }), 200);
  assert.equal(applied.body.weeks.length, 1); assert.equal(applied.body.receipts.length, 1); assert.equal(applied.body.weeks[0].revisions.length, 1);
  const retry = expect(await request(f.app, '/api/admin/schedule/apply', { method: 'POST', data: apply, etag: schedule.etag }), 200);
  assert.deepEqual(retry.body, applied.body);
  error(await request(f.app, '/api/admin/schedule/apply', { method: 'POST', data: { ...apply, reviewOnly: true }, etag: applied.etag }), 409);
  const staleNew = { requestId: nextId('new-plan'), preview: refreshed.body };
  error(await request(f.app, '/api/admin/schedule/apply', { method: 'POST', data: staleNew, etag: schedule.etag }), 412, 'version_conflict');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), applied.body);
});

test('题目维护保留正式答案快照；旧题草稿可保存但不能冒充新题答案，引用题不能删除', async t => {
  const f = await fixture(t), first = await initial(f.app), changed = clone(first.catalog.body);
  const u = changed.units.find(unit => unit.id === first.unit.id), task = u.tasks.find(task => task.id === u.acceptanceTaskId);
  task.questions.push({ id: 'question-boundary', kind: 'reflection', prompt: '输入为空时，为什么先检查数量？', hints: ['先画空数组'], referencePoints: ['避免除零'], version: 1, archived: false, criterionId: u.criteria[0].id });
  const added = expect(await request(f.app, '/api/admin/curriculum', { method: 'PUT', data: changed, etag: first.catalog.etag }), 200);
  const unit = added.body.units.find(unit => unit.id === u.id), doc = expect(await request(f.app, first.route), 200);
  const input = record(unit, { answers: [{ questionId: 'question-boundary', questionVersion: 1, text: '先验证元素数量，空数组不计算平均数。', evidence: 'zero-input.txt' }] });
  const saved = expect(await request(f.app, first.route + '/records', options('POST', input, doc, added)), 200);
  const checked = expect(await request(f.app, first.route, options('PATCH', assessment(unit), saved, added)), 200);
  assert.equal((await request(f.app, '/api/admin/overview')).body.units.find(value => value.id === unit.id).status, 'accepted');
  const changeAgain = clone(added.body), question = changeAgain.units.find(unit => unit.id === u.id).tasks.find(task => task.id === u.acceptanceTaskId).questions[0]; question.prompt = '新版：非法输入和空输入分别怎样处理？'; question.referencePoints.push('检查读取函数返回值');
  const revised = expect(await request(f.app, '/api/admin/curriculum', { method: 'PUT', data: changeAgain, etag: added.etag }), 200);
  const currentUnit = revised.body.units.find(unit => unit.id === u.id), currentDoc = expect(await request(f.app, first.route), 200);
  assert.equal(currentDoc.body.records[0].answers[0].snapshot.prompt, '输入为空时，为什么先检查数量？');
  assert.equal(currentUnit.tasks.find(task => task.id === currentUnit.acceptanceTaskId).questions[0].version, 2);
  assert.equal((await request(f.app, '/api/admin/overview')).body.units.find(value => value.id === unit.id).status, 'review');
  const oldDraft = draft(unit, { answers: [{ ...input.answers[0], text: '保留的旧题回答草稿' }] });
  const kept = expect(await request(f.app, first.route, options('PATCH', { drafts: { [unit.acceptanceTaskId]: oldDraft } }, currentDoc, revised)), 200);
  assert.equal(kept.body.drafts[unit.acceptanceTaskId].answers[0].questionVersion, 1);
  error(await request(f.app, first.route + '/records', options('POST', { ...input, requestId: nextId('stale-answer'), assessmentVersion: currentUnit.assessmentVersion }, kept, revised)), 409);
  const removing = clone(revised.body); removing.units.find(unit => unit.id === u.id).tasks.find(task => task.id === u.acceptanceTaskId).questions = [];
  error(await request(f.app, '/api/admin/curriculum', { method: 'PUT', data: removing, etag: revised.etag }), 409);
  assert.equal((await request(f.app, first.route)).body.records.length, 1);
  assert.equal(checked.body.records[0].answers[0].text, input.answers[0].text);
});
