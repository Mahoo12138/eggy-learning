import { readFile, writeFile, mkdir, rename, unlink, open, readdir, cp, rm, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export function httpError(status, message, code = 'invalid_request') {
  return Object.assign(new Error(message), { status, code });
}
export const encode = value => JSON.stringify(value, null, 2) + '\n';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const fingerprint = value => createHash('sha256').update(encode(canonical(value))).digest('hex');
export const etag = value => '"' + fingerprint(value) + '"';
export const safeId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,159}$/.test(value);

export class Store {
  constructor(root, { beforeRename, afterBackupRename } = {}) {
    this.root = root;
    this.beforeRename = beforeRename;
    this.afterBackupRename = afterBackupRename;
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

  async dataSwapEntries() {
    let entries;
    try { entries = await readdir(this.root, { withFileTypes: true }); }
    catch (error) { throw httpError(500, `无法检查数据发布状态：${error.code || error.message}`, 'storage_error'); }
    return {
      backups: entries.filter(entry => entry.isDirectory() && entry.name.startsWith('.data-backup-')).map(entry => entry.name).sort(),
      stages: entries.filter(entry => entry.isDirectory() && entry.name.startsWith('.data-stage-')).map(entry => entry.name).sort()
    };
  }

  async assertPlainDataTree(directory = join(this.root, 'data')) {
    const pending = [directory];
    while (pending.length) {
      const current = pending.pop();
      let rootStat, entries;
      try {
        rootStat = await lstat(current);
        entries = await readdir(current, { withFileTypes: true });
      } catch (error) {
        throw httpError(500, `无法检查数据目录：${error.code || error.message}`, 'storage_error');
      }
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw httpError(500, 'data/ 及其发布副本只能包含普通目录和文件，不能使用符号链接。', 'storage_error');
      for (const entry of entries) {
        const target = join(current, entry.name);
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw httpError(500, `数据目录包含不安全的文件类型：${entry.name}`, 'storage_error');
        if (entry.isDirectory()) pending.push(target);
      }
    }
  }

  async clearDataSwapArtifacts() {
    const { backups, stages } = await this.dataSwapEntries();
    for (const name of [...backups, ...stages]) {
      try { await rm(join(this.root, name), { recursive: true, force: true }); }
      catch (error) { throw httpError(500, `无法清理数据发布副本 ${name}：${error.code || error.message}`, 'storage_error'); }
    }
  }

  async recoverDataSwap(validate) {
    if (typeof validate !== 'function') throw httpError(500, '数据恢复缺少校验步骤。', 'storage_error');
    let { backups } = await this.dataSwapEntries();
    let dataExists = true;
    try { await readdir(join(this.root, 'data')); }
    catch (error) { if (error.code === 'ENOENT') dataExists = false; else throw error; }
    if (!dataExists) {
      if (backups.length !== 1) throw httpError(500, '数据目录缺失且无法唯一确定可恢复版本，请检查 .data-backup-*。', 'storage_error');
      await rename(join(this.root, backups[0]), join(this.root, 'data'));
      backups = [];
    }

    let currentResult, primaryError;
    try {
      await this.assertPlainDataTree();
      currentResult = await validate();
    } catch (error) { primaryError = error; }
    if (!primaryError) {
      await this.clearDataSwapArtifacts();
      return currentResult;
    }
    if (!dataExists || backups.length !== 1) throw primaryError;

    const token = `${process.pid}-${randomUUID()}`;
    const data = join(this.root, 'data');
    const backup = join(this.root, backups[0]);
    const displaced = join(this.root, `.data-rejected-current-${token}`);
    let currentMoved = false;
    try {
      await rename(data, displaced);
      currentMoved = true;
      await rename(backup, data);
    } catch {
      if (currentMoved) await rename(displaced, data).catch(() => {});
      throw primaryError;
    }
    let recoveredResult;
    try {
      await this.assertPlainDataTree();
      recoveredResult = await validate();
    } catch {
      const rejectedBackup = join(this.root, `.data-rejected-backup-${token}`);
      await rename(data, rejectedBackup).catch(() => {});
      await rename(displaced, data).catch(() => {});
      throw primaryError;
    }
    await this.clearDataSwapArtifacts();
    return recoveredResult;
  }

  async writeDataBatch(entries) {
    if (!Array.isArray(entries) || !entries.length) throw httpError(500, '数据批量保存内容为空。', 'storage_error');
    const normalized = entries.map(entry => {
      if (!entry || typeof entry.relative !== 'string' || !entry.relative.startsWith('data/') || entry.relative.split('/').some(part => !part || part === '..' || part.startsWith('.'))) {
        throw httpError(500, '数据批量保存路径无效。', 'storage_error');
      }
      return { relative: entry.relative, value: entry.value };
    });
    if (new Set(normalized.map(entry => entry.relative.toLowerCase())).size !== normalized.length) throw httpError(500, '数据批量保存路径重复或仅大小写不同。', 'storage_error');

    const artifacts = await this.dataSwapEntries();
    if (artifacts.backups.length || artifacts.stages.length) throw httpError(500, '存在尚未清理的数据发布副本，请重启服务完成恢复后再保存。', 'storage_error');
    await this.assertPlainDataTree();

    const token = `${process.pid}-${randomUUID()}`;
    const data = join(this.root, 'data');
    const stage = join(this.root, `.data-stage-${token}`);
    const backup = join(this.root, `.data-backup-${token}`);
    let dataMoved = false;
    try {
      await cp(data, stage, { recursive: true, errorOnExist: true, force: false });
      await this.assertPlainDataTree(stage);
      for (const entry of normalized) {
        const stagedTarget = join(stage, entry.relative.slice('data/'.length));
        await mkdir(dirname(stagedTarget), { recursive: true });
        const handle = await open(stagedTarget, 'w', 0o600);
        try { await handle.writeFile(encode(entry.value), 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
      }
      if (this.beforeRename) {
        for (const entry of normalized) await this.beforeRename({ relative: entry.relative, target: join(this.root, entry.relative), temporary: join(stage, entry.relative.slice('data/'.length)) });
      }
      await rename(data, backup);
      dataMoved = true;
      if (this.afterBackupRename) await this.afterBackupRename({ data, backup, stage });
      try { await rename(stage, data); }
      catch (error) { await rename(backup, data); dataMoved = false; throw error; }
      dataMoved = false;
      await rm(backup, { recursive: true, force: true }).catch(() => {});
    } catch (error) {
      if (dataMoved) await rename(backup, data).catch(() => {});
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      throw httpError(500, `批量保存 data/ 失败，原版本保持可恢复：${error.code || error.message}`, 'storage_error');
    }
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
