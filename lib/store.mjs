import { readFile, writeFile, mkdir, rename, unlink, open, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function httpError(status, message, code = 'invalid_request') {
  return Object.assign(new Error(message), { status, code });
}
export const encode = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const fingerprint = value => createHash('sha256').update(encode(canonical(value))).digest('hex');
export const etag = value => '"' + fingerprint(value) + '"';
export const safeId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(value);

export class Store {
  constructor(root, { beforeRename } = {}) {
    this.root = root;
    this.beforeRename = beforeRename;
    this.queue = Promise.resolve();
  }
  run(operation) {
    const pending = this.queue.then(operation);
    this.queue = pending.catch(() => {});
    return pending;
  }
  async read(relative, fallback) {
    let raw;
    try { raw = await readFile(join(this.root, relative), 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback);
      throw httpError(500, `无法读取 ${relative}：${error.code || error.message}`, 'storage_error');
    }
    try { return JSON.parse(raw); }
    catch { throw httpError(500, `${relative} 不是有效 JSON，请先修复文件或 Git 合并冲突；原文件未覆盖。`, 'corrupt_data'); }
  }
  async write(relative, value) {
    const target = join(this.root, relative);
    const temporary = target + '.tmp-' + process.pid + '-' + randomUUID();
    await mkdir(dirname(target), { recursive: true });
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(encode(value), 'utf8');
      await handle.sync();
      await handle.close();
      handle = null;
      if (this.beforeRename) await this.beforeRename({ relative, target, temporary });
      await rename(temporary, target);
    } catch (error) {
      await handle?.close().catch(() => {});
      await unlink(temporary).catch(() => {});
      throw httpError(500, `保存 ${relative} 失败，未确认保存：${error.code || error.message}`, 'storage_error');
    }
    return value;
  }
  async unitFiles() {
    let entries;
    try { entries = await readdir(join(this.root, 'data/units'), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return entries.filter(x => x.name.endsWith('.json')).map(x => {
      if (!x.isFile() || !safeId(x.name.slice(0, -5))) throw httpError(500, `非法单元文件：${x.name}`, 'corrupt_data');
      return x.name.slice(0, -5);
    });
  }
}

export function requireMatch(actual, supplied) {
  if (!supplied) throw httpError(428, '缺少版本信息，请重新读取后再保存。', 'version_required');
  if (supplied !== actual) throw httpError(412, '数据已由另一个页面或文件更新。当前输入仍保留，请读取最新版本比较后再保存。', 'version_conflict');
}

export async function acquireLock(root) {
  const folder = join(root, '.local');
  const path = join(folder, 'server.lock');
  const token = randomUUID();
  await mkdir(folder, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, encode({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
      return async () => {
        try {
          const lock = JSON.parse(await readFile(path, 'utf8'));
          if (lock.token === token) await unlink(path);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Serialize stale-lock reclamation so two simultaneous starters cannot
      // remove the new owner's lock after both observed the same dead PID.
      const guard = path + '.reclaim';
      let claim;
      try { claim = await open(guard, 'wx', 0o600); }
      catch { throw new Error('另一个服务正在取得运行锁；若没有服务，请检查 .local/server.lock.reclaim。'); }
      try {
        let lock;
        try { lock = JSON.parse(await readFile(path, 'utf8')); }
        catch (error) {
          if (error.code !== 'ENOENT') throw new Error('运行锁无法读取，请确认没有服务正在运行后检查 .local/server.lock。');
        }
        if (lock) {
          if (!Number.isInteger(lock.pid) || lock.pid < 1) throw new Error('运行锁格式异常，请检查 .local/server.lock。');
          let alive = true;
          try { process.kill(lock.pid, 0); }
          catch (error) { if (error.code === 'ESRCH') alive = false; }
          if (alive) throw new Error(`该数据目录已有运行进程（PID ${lock.pid}），请使用现有服务或先停止它。`);
          await unlink(path);
        }
        await writeFile(path, encode({ pid: process.pid, token }), { flag: 'wx', mode: 0o600 });
        return async () => {
          try { if (JSON.parse(await readFile(path, 'utf8')).token === token) await unlink(path); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        };
      } finally {
        await claim.close();
        await unlink(guard).catch(() => {});
      }
    }
  }
  throw new Error('无法取得运行锁，请检查是否同时启动了两个服务。');
}
