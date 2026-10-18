const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END = 0x06054b50;
const ZIP_VERSION = 20;
const ZIP_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION;
const ZIP_UTF8 = 0x0800;
const ZIP_STORE = 0;
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00:00
const MAX_ZIP32 = 0xffffffff;

const encoder = new TextEncoder();
let crcTable;

function tableForCrc32() {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    crcTable[index] = value >>> 0;
  }
  return crcTable;
}

export function crc32(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const table = tableForCrc32();
  let value = 0xffffffff;
  for (const byte of input) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function archiveSegment(value, fallback) {
  const normalized = String(value ?? '').normalize('NFKC').replace(/[^\p{Letter}\p{Number}._-]+/gu, '-');
  const trimmed = normalized.replace(/^[.-]+|[.-]+$/g, '').slice(0, 80);
  return trimmed || fallback;
}

export function projectArchiveNames(projectId, stateId) {
  const rootName = `eggy-${archiveSegment(projectId, 'project')}-${archiveSegment(stateId, 'snapshot')}`;
  return { rootName, fileName: `${rootName}.zip` };
}

export function zipEntryMode(path, directory = false) {
  if (directory) return 0o040755;
  const executable = /\.(?:sh|bash|zsh|command)$/i.test(path)
    || /(?:^|\/)(?:configure|gradlew|mvnw)$/.test(path);
  return executable ? 0o100755 : 0o100644;
}

function makeHeader(length) {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

function append(target, offset, source) {
  target.set(source, offset);
  return offset + source.length;
}

function portablePathKey(value) {
  return value.split('/').map(part => part.normalize('NFKC').normalize('NFC').toLowerCase()).join('/');
}

function validatePortableFileTree(paths) {
  const pathsByPortableKey = new Map();
  for (const path of paths) {
    const key = portablePathKey(path);
    const previous = pathsByPortableKey.get(key);
    if (previous !== undefined) {
      throw new TypeError(`工程文件路径在忽略大小写或 Unicode 归一化后冲突：${previous}、${path}`);
    }
    pathsByPortableKey.set(key, path);
  }
  for (const [key, path] of pathsByPortableKey) {
    const parts = key.split('/');
    for (let length = 1; length < parts.length; length++) {
      const parent = pathsByPortableKey.get(parts.slice(0, length).join('/'));
      if (parent !== undefined) throw new TypeError(`工程路径同时把 ${parent} 作为文件、又把它作为 ${path} 的目录。`);
    }
  }
}

function projectEntries(files, rootName) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new TypeError('工程快照文件须为路径到文本的对象。');
  const directories = new Set([`${rootName}/`]);
  const entries = [];
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/');
    if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0') || parts.some(part => !part || part === '.' || part === '..')) {
      throw new TypeError(`工程文件路径不安全：${path}`);
    }
    if (typeof content !== 'string') throw new TypeError(`工程文件 ${path} 不是 UTF-8 文本。`);
    for (let index = 1; index < parts.length; index++) directories.add(`${rootName}/${parts.slice(0, index).join('/')}/`);
    entries.push({ name: `${rootName}/${path}`, content: encoder.encode(content), directory: false });
  }
  validatePortableFileTree(Object.keys(files));
  for (const name of directories) entries.push({ name, content: new Uint8Array(), directory: true });
  return entries.sort((left, right) => compareNames(left.name, right.name));
}

/**
 * Build a deterministic ZIP32 archive. Files are stored without compression so
 * browsers need no dependency or worker, while UTF-8 names and Unix modes stay
 * available to normal ZIP extractors.
 */
export function createProjectStateZip(files, { projectId = 'project', stateId = 'snapshot' } = {}) {
  const { rootName, fileName } = projectArchiveNames(projectId, stateId);
  const entries = projectEntries(files, rootName).map(entry => {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.content);
    const mode = zipEntryMode(entry.name, entry.directory);
    return { ...entry, nameBytes: name, checksum, mode, localOffset: 0 };
  });
  if (entries.length > 0xffff) throw new RangeError('工程文件数量超过 ZIP32 上限。');

  let localSize = 0;
  for (const entry of entries) {
    entry.localOffset = localSize;
    localSize += 30 + entry.nameBytes.length + entry.content.length;
  }
  let centralSize = 0;
  for (const entry of entries) centralSize += 46 + entry.nameBytes.length;
  const totalSize = localSize + centralSize + 22;
  if (totalSize > MAX_ZIP32) throw new RangeError('工程快照超过 ZIP32 上限。');

  const archive = new Uint8Array(totalSize);
  let offset = 0;
  for (const entry of entries) {
    const { bytes, view } = makeHeader(30);
    view.setUint32(0, ZIP_LOCAL_FILE, true);
    view.setUint16(4, ZIP_VERSION, true);
    view.setUint16(6, ZIP_UTF8, true);
    view.setUint16(8, ZIP_STORE, true);
    view.setUint16(10, ZIP_DOS_TIME, true);
    view.setUint16(12, ZIP_DOS_DATE, true);
    view.setUint32(14, entry.checksum, true);
    view.setUint32(18, entry.content.length, true);
    view.setUint32(22, entry.content.length, true);
    view.setUint16(26, entry.nameBytes.length, true);
    view.setUint16(28, 0, true);
    offset = append(archive, offset, bytes);
    offset = append(archive, offset, entry.nameBytes);
    offset = append(archive, offset, entry.content);
  }

  const centralOffset = offset;
  for (const entry of entries) {
    const { bytes, view } = makeHeader(46);
    view.setUint32(0, ZIP_CENTRAL_FILE, true);
    view.setUint16(4, ZIP_MADE_BY_UNIX, true);
    view.setUint16(6, ZIP_VERSION, true);
    view.setUint16(8, ZIP_UTF8, true);
    view.setUint16(10, ZIP_STORE, true);
    view.setUint16(12, ZIP_DOS_TIME, true);
    view.setUint16(14, ZIP_DOS_DATE, true);
    view.setUint32(16, entry.checksum, true);
    view.setUint32(20, entry.content.length, true);
    view.setUint32(24, entry.content.length, true);
    view.setUint16(28, entry.nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    const external = (((entry.mode & 0xffff) << 16) | (entry.directory ? 0x10 : 0)) >>> 0;
    view.setUint32(38, external, true);
    view.setUint32(42, entry.localOffset, true);
    offset = append(archive, offset, bytes);
    offset = append(archive, offset, entry.nameBytes);
  }

  const { bytes: end, view } = makeHeader(22);
  view.setUint32(0, ZIP_END, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  append(archive, offset, end);
  return { bytes: archive, fileName, rootName, entryCount: entries.length };
}

/**
 * Start a browser download without creating HTML from course values. The
 * object URL is always revoked on the next task after the click is dispatched.
 */
export function downloadProjectStateZip(archive, environment = {}) {
  const documentObject = environment.documentObject ?? globalThis.document;
  const urlObject = environment.urlObject ?? globalThis.URL;
  const BlobClass = environment.BlobClass ?? globalThis.Blob;
  const schedule = environment.schedule ?? (callback => setTimeout(callback, 0));
  if (!documentObject?.createElement || !urlObject?.createObjectURL || !urlObject?.revokeObjectURL || !BlobClass) {
    throw new Error('当前浏览器不支持下载工程 ZIP。');
  }
  const blob = new BlobClass([archive.bytes], { type: 'application/zip' });
  const objectUrl = urlObject.createObjectURL(blob);
  let link;
  try {
    link = documentObject.createElement('a');
    link.href = objectUrl;
    link.download = archive.fileName;
    link.hidden = true;
    documentObject.body?.append?.(link);
    link.click();
  } finally {
    link?.remove?.();
    schedule(() => urlObject.revokeObjectURL(objectUrl));
  }
}
