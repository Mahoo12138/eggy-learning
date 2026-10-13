import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store, acquireLock, httpError, fingerprint, etag, requireMatch, safeId } from './lib/store.mjs';
import { validateCurriculum, freshUnit, validateUnit, patchUnit, appendRecord, summarize, effectiveRecords } from './shared/study-domain.mjs';
import { validateSchedule, previewSchedule, applySchedule, weekStartFor, shanghaiToday } from './shared/schedule.mjs';
import { getGitHistory } from './lib/git-history.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const LIMIT = 4 * 1024 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

async function body(req) {
  if (!/^application\/json(?:\s*;.*)?$/i.test(req.headers['content-type'] || '')) throw httpError(415, '写入只接受 application/json。');
  if (Number(req.headers['content-length']) > LIMIT) throw httpError(413, '请求过大，最多 4 MB。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMIT) throw httpError(413, '请求过大，最多 4 MB。');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, '请求不是有效 JSON。'); }
}
function json(res, status, value, version = false) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...(version ? { ETag: etag(value) } : {}) });
  res.end(JSON.stringify(value));
}
function allowedHosts(host, extra) {
  const names = new Set(['localhost', '127.0.0.1', '::1', host]);
  if (host === '0.0.0.0' || host === '::') for (const list of Object.values(networkInterfaces())) for (const address of list || []) names.add(address.address);
  for (const item of (extra || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)) names.add(item);
  return names;
}
function validateHost(req, server, allowed) {
  const raw = req.headers.host;
  if (!raw || /[\s/@?#\\]/.test(raw)) throw httpError(403, '不允许的 Host。');
  let authority;
  try { authority = new URL('http://' + raw); } catch { throw httpError(403, '不允许的 Host。'); }
  const hostname = authority.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!allowed.has(hostname) || Number(authority.port || 80) !== server.address().port) throw httpError(403, '不允许的 Host。');
  return authority.origin;
}
function assertRequestId(id) { if (!safeId(id)) throw httpError(400, '提交编号无效。'); }

export async function startServer({ root = ROOT, assetRoot = ROOT, host = '127.0.0.1', port = 3000, learnerEmail = process.env.LEARNER_GIT_EMAIL, allowedHostnames = process.env.ALLOWED_HOSTS, lock = true, storeOptions = {} } = {}) {
  const store = new Store(root, storeOptions);
  const release = lock ? await acquireLock(root) : async () => {};
  const hosts = allowedHosts(host, allowedHostnames);
  async function state() {
    const raw = await store.read('data/curriculum.json');
    let curriculum;
    try { curriculum = validateCurriculum(raw); }
    catch (error) { throw httpError(500, `data/curriculum.json 校验失败：${error.message}`, 'corrupt_data'); }
    const files = await store.unitFiles();
    const known = new Set(curriculum.units.map(u => u.id));
    if (files.some(id => !known.has(id))) throw httpError(500, '单元档案含课程中不存在的编号；请先修复引用，不会丢弃原记录。', 'corrupt_data');
    const docs = await Promise.all(curriculum.units.map(async unit => {
      const doc = await store.read(`data/units/${unit.id}.json`, freshUnit(unit));
      try { return validateUnit(doc, curriculum); }
      catch (error) { throw httpError(500, `data/units/${unit.id}.json 校验失败：${error.message}`, 'corrupt_data'); }
    }));
    let schedule;
    try { schedule = validateSchedule(await store.read('data/schedule.json'), curriculum, docs); }
    catch (error) { throw httpError(500, `data/schedule.json 校验失败：${error.message}`, 'corrupt_data'); }
    return { curriculum, docs, schedule, basis: { curriculum: etag(curriculum), schedule: etag(schedule), units: etag(docs) } };
  }
  try { await state(); } catch (error) { await release(); throw error; }
  async function staticFile(req, res, pathname) {
    if (!['GET', 'HEAD'].includes(req.method)) throw httpError(405, '此资源不支持该方法。');
    let base, relative;
    if (pathname.startsWith('/shared/')) {
      if (!['/shared/study-domain.mjs'].includes(pathname)) throw httpError(404, '没有找到该文件。');
      base = join(assetRoot, 'shared'); relative = 'study-domain.mjs';
    } else {
      base = join(assetRoot, 'public'); relative = pathname === '/' ? 'index.html' : pathname.slice(1);
    }
    if (!relative || relative.split('/').some(part => part.startsWith('.') || part === '..') || relative.includes('\\') || relative.includes('\0')) throw httpError(404, '没有找到该文件。');
    const requested = resolve(base, relative);
    if (!requested.startsWith(resolve(base) + sep)) throw httpError(404, '没有找到该文件。');
    let file;
    try {
      file = await realpath(requested);
      if (!file.startsWith(await realpath(base) + sep) || !(await stat(file)).isFile()) throw new Error('not file');
    } catch { throw httpError(404, '没有找到该文件。'); }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    try {
      const origin = validateHost(req, server, hosts);
      const url = new URL(req.url, origin);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); }
      catch { throw httpError(400, '网址编码无效。'); }
      if (!pathname.startsWith('/api/')) return await staticFile(req, res, pathname);
      const method = req.method;
      if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) throw httpError(405, '不支持该方法。');
      if (method !== 'GET' && req.headers.origin !== origin) throw httpError(403, '只允许管理页的同源写入请求。', 'origin_rejected');
      if (pathname === '/api/admin/history' && method === 'GET') {
        return json(res, 200, await getGitHistory({ root, learnerEmail, kind: url.searchParams.get('kind') || 'all', offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 20) }));
      }
      const input = method === 'GET' ? null : await body(req);
      await store.run(async () => {
        const { curriculum, docs, schedule, basis } = await state();
        if (['/api/catalog', '/api/admin/curriculum'].includes(pathname)) {
          if (method === 'GET') return json(res, 200, curriculum, true);
          if (pathname === '/api/admin/curriculum' && method === 'PUT') {
            requireMatch(basis.curriculum, req.headers['if-match']);
            const next = validateCurriculum(input, curriculum, docs, schedule);
            const nextIds = new Set(next.units.map(u => u.id));
            if ((await store.unitFiles()).some(id => !nextIds.has(id))) throw httpError(400, '已有落盘档案的单元请使用归档，不能物理删除。');
            for (const doc of docs.filter(d => nextIds.has(d.unitId))) validateUnit(doc, next);
            validateSchedule(schedule, next, docs.filter(d => nextIds.has(d.unitId)));
            await store.write('data/curriculum.json', next);
            return json(res, 200, next, true);
          }
        }
        if (pathname === '/api/admin/overview' && method === 'GET') {
          const summary = summarize(curriculum, docs);
          const thisWeek = weekStartFor(shanghaiToday());
          const latest = schedule.weeks.find(w => w.weekStart === thisWeek)?.revisions.at(-1);
          const records = docs.flatMap(d => effectiveRecords(d));
          const planned = rev => rev?.slots.flatMap(s => s.items).reduce((n, i) => n + i.estimatedMinutes, 0) || 0;
          summary.scheduleSummary = { weekStart: thisWeek, capacityMinutes: latest?.slots.reduce((n, s) => n + s.minutes, 0) || 0, plannedMinutes: planned(latest), actualMinutes: records.filter(r => weekStartFor(r.date) === thisWeek).reduce((n, r) => n + r.minutes, 0), paused: !!latest && !latest.slots.length, scheduled: !!latest };
          summary.recentWeeks = Array.from({ length: 4 }, (_, i) => {
            const d = new Date(thisWeek + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - (3 - i) * 7);
            const weekStart = d.toISOString().slice(0, 10), week = schedule.weeks.find(w => w.weekStart === weekStart), current = week?.revisions.at(-1);
            return { weekStart, originalPlannedMinutes: planned(week?.revisions[0]), currentPlannedMinutes: planned(current), capacityMinutes: current?.slots.reduce((n, s) => n + s.minutes, 0) || 0, actualMinutes: records.filter(r => weekStartFor(r.date) === weekStart).reduce((n, r) => n + r.minutes, 0), paused: !!current && !current.slots.length, scheduled: !!current };
          });
          return json(res, 200, summary);
        }
        if (pathname === '/api/admin/export' && method === 'GET') return json(res, 200, { schemaVersion: 1, exportedAt: new Date().toISOString(), curriculum, units: docs, schedule });
        if (pathname === '/api/admin/schedule' && method === 'GET') return json(res, 200, schedule, true);
        if (pathname === '/api/admin/schedule/preview' && method === 'POST') return json(res, 200, { ...previewSchedule(input, curriculum, docs, schedule), basis });
        if (pathname === '/api/admin/schedule/apply' && method === 'POST') {
          assertRequestId(input?.requestId);
          const payloadHash = fingerprint(input);
          const prior = schedule.receipts.find(r => r.requestId === input.requestId);
          if (prior) {
            if (prior.payloadHash !== payloadHash) throw httpError(409, '同一提交编号不能用于不同安排。');
            return json(res, 200, schedule, true);
          }
          requireMatch(basis.schedule, req.headers['if-match']);
          if (!input.preview || fingerprint(input.preview.basis) !== fingerprint(basis)) throw httpError(409, '预览后课程、记录或周安排已经变化。输入仍保留，请重新预览。', 'preview_stale');
          if (input.preview.request?.requestId !== input.requestId) throw httpError(400, '应用编号与预览编号不一致。');
          const preview = previewSchedule(input.preview.request, curriculum, docs, schedule);
          const next = applySchedule(schedule, preview, { requestId: input.requestId, payloadHash, savedAt: new Date().toISOString(), reviewOnly: input.reviewOnly === true });
          validateSchedule(next, curriculum, docs);
          await store.write('data/schedule.json', next);
          return json(res, 200, next, true);
        }
        const unitRoute = pathname.match(/^\/api\/admin\/units\/([A-Za-z0-9][A-Za-z0-9_-]{0,159})(\/records)?$/);
        if (unitRoute) {
          const id = unitRoute[1], doc = docs.find(d => d.unitId === id);
          if (!doc) throw httpError(404, '该单元不存在。');
          if (!unitRoute[2] && method === 'GET') return json(res, 200, doc, true);
          if (unitRoute[2] && method === 'POST') {
            assertRequestId(input?.requestId);
            const payloadHash = fingerprint(input);
            const prior = doc.records.find(r => r.requestId === input.requestId);
            if (prior) {
              if (prior.payloadHash !== payloadHash) throw httpError(409, '同一提交编号不能用于不同训练内容。');
              return json(res, 200, doc, true);
            }
            requireMatch(etag(doc), req.headers['if-match']);
            requireMatch(basis.curriculum, req.headers['x-curriculum-version']);
            if (input.scheduleItemId) {
              const matching = schedule.weeks.flatMap(w => w.revisions.flatMap(r => [...r.slots.flatMap(s => s.items), ...r.unassigned])).find(i => i.id === input.scheduleItemId && i.taskId === input.taskId);
              if (!matching) throw httpError(400, '安排片段不存在或不属于此任务。');
            }
            const next = appendRecord(doc, input, curriculum, { id: randomUUID(), savedAt: new Date().toISOString(), payloadHash });
            await store.write(`data/units/${id}.json`, next);
            return json(res, 200, next, true);
          }
          if (!unitRoute[2] && method === 'PATCH') {
            requireMatch(etag(doc), req.headers['if-match']);
            requireMatch(basis.curriculum, req.headers['x-curriculum-version']);
            const next = patchUnit(doc, input, curriculum);
            await store.write(`data/units/${id}.json`, next);
            return json(res, 200, next, true);
          }
        }
        throw httpError(404, '没有找到该接口或不支持此方法。');
      });
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, error.status || 500, { error: error.message || '服务处理失败，未确认保存。', code: error.code || (error.status === 409 ? 'conflict' : 'request_failed') });
      else if (!res.writableEnded) res.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  try { await new Promise((done, reject) => { server.once('error', reject); server.listen(port, host, done); }); }
  catch (error) { await release(); throw error; }
  const address = server.address();
  let closed = false;
  return {
    server, store,
    url: `http://${host === '::' || host === '::1' ? '[' + host + ']' : host}:${address.port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
      await store.queue;
      await release();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    try { process.loadEnvFile(join(ROOT, '.env.local')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const args = process.argv.slice(2);
    const options = { host: process.env.HOST || '127.0.0.1', port: Number(process.env.PORT || 3000) };
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--host' && args[i + 1]) options.host = args[++i];
      else if (args[i] === '--port' && args[i + 1]) options.port = Number(args[++i]);
      else throw new Error('用法：node server.mjs [--host 127.0.0.1] [--port 3000]');
    }
    if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('PORT 须为 0–65535 的整数。');
    const app = await startServer(options);
    console.log(`学习者工作台：${app.url}/learner.html`);
    console.log(`管理者工作台：${app.url}/admin.html`);
    console.log(`课程总览：${app.url}/plan.html`);
    console.log('保存写入 data/；Git 提交和推送由你手动执行。');
    if (options.host === '0.0.0.0' || options.host === '::') console.log('局域网已开启：可访问此服务的人拥有相同的读写能力。');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
