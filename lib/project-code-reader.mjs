import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprint, httpError } from './store.mjs';
import { PROJECT_CODE_MAX_PACKAGE_BYTES, sanitizeProjectCodePackage } from './project-code-delivery.mjs';

function packagePath(project, status) {
  const file = project.codeDelivery.packageFile;
  if (typeof file !== 'string' || file !== `project-code/${project.id}.json` || !/^project-code\/[a-z0-9][a-z0-9_-]{0,159}\.json$/.test(file)) {
    throw httpError(status, `作品 ${project.id} 的代码包路径无效。`, 'invalid_code_package');
  }
  return join('data', file);
}

function contractFingerprint(project) {
  return fingerprint({
    id: project.id,
    contractVersion: project.guidancePolicy?.codeDeliveryContractVersion,
    codeDelivery: project.codeDelivery,
    chapters: project.chapters.map(chapter => ({
      id: chapter.id,
      snapshotStateId: chapter.snapshotStateId,
      guidedSteps: chapter.guidedSteps?.map(step => ({ id: step.id, codeStepId: step.codeStepId, targetFiles: step.targetFiles })) || []
    }))
  });
}

// Identity and change time also change when bytes are replaced while mtime is restored.
function fileVersion(metadata) {
  return [metadata.dev, metadata.ino, metadata.size, metadata.mtimeNs, metadata.ctimeNs].join(':');
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

/** Read validated source snapshots; publication candidates never read or populate the published cache. */
export function createProjectCodeReader(root) {
  const cache = new Map();

  async function read(project, candidate) {
    const status = candidate ? 400 : 500;
    if (!project.codeDelivery) throw httpError(candidate ? 400 : 404, '这个作品还没有发布完整代码包。', 'code_package_not_found');
    const absolute = join(root, packagePath(project, status));
    const contract = contractFingerprint(project);
    const invalid = message => httpError(status, `作品 ${project.id} 的代码包${message}`, 'invalid_code_package');
    let handle, raw, version;
    try {
      // Nonblocking open lets us reject a FIFO without waiting for a writer.
      handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const metadata = await handle.stat({ bigint: true });
      if (!metadata.isFile()) throw invalid('必须是普通文件。');
      if (metadata.size > BigInt(PROJECT_CODE_MAX_PACKAGE_BYTES)) throw invalid('超过 16 MB 上限。');
      version = fileVersion(metadata);
      const cached = candidate ? null : cache.get(project.id);
      if (cached?.contract === contract && cached.version === version) return cached.value;

      // One extra byte detects growth without allocating an unbounded readFile buffer.
      const buffer = Buffer.alloc(Number(metadata.size) + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== Number(metadata.size) || fileVersion(await handle.stat({ bigint: true })) !== version) {
        throw invalid('在读取期间发生变化，请重试。');
      }
      raw = buffer.subarray(0, length);
    } catch (error) {
      if (error.code === 'invalid_code_package') throw error;
      if (error.code === 'ENOENT') throw invalid('文件缺失。');
      throw httpError(status, `无法读取作品 ${project.id} 的代码包：${error.code || error.message}`, 'invalid_code_package');
    } finally {
      await handle?.close();
    }
    const digest = createHash('sha256').update(raw).digest('hex');
    if (digest !== project.codeDelivery.packageSha256) throw invalid('摘要不匹配，课程引用与源码包不是同一版本。');
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); }
    catch { throw invalid('不是有效 JSON。'); }
    let value;
    try { value = freeze(sanitizeProjectCodePackage(parsed, project)); }
    catch (error) { throw invalid(`校验失败：${error.message}`); }
    if (!candidate) cache.set(project.id, { contract, version, value });
    return value;
  }

  return {
    readPublished: project => read(project, false),
    validateCandidate: project => read(project, true)
  };
}
