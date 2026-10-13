import { execFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const SCOPE = '当前 HEAD 可达的本地提交';
const MAX_COMMITS = 20000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const COMMAND_TIMEOUT = 5000;
const REQUEST_TIMEOUT = 12000;
const HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const FORMAT = '%H%x00%s%x00%an%x00%ae%x00%ce%x00%aI%x00%cI%x00%P';
const PREFIX = ['--no-pager', '--no-replace-objects', '-c', 'color.ui=false', '-c', 'log.showSignature=false'];

function normalizeEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function validEmail(value) {
  if (!value || value.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/i.test(value)) return false;
  const [local, domain] = value.split('@');
  return local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && domain.includes('.') && domain.split('.').every(label => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}
function base(learnerEmail) {
  return { status: 'error', message: '', learnerEmail, head: null, branch: null, shallow: false, scope: SCOPE, items: [], hasMore: false, nextOffset: null };
}
function finish(result, status, message) { return { ...result, status, message }; }
function failure(result, error) {
  if (error.code === 'ENOENT' || error.code === 'EACCES') return finish(result, 'unavailable', 'Git 不可用，请安装 Git 并确认服务可以执行它；学习文件仍可正常使用。');
  if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return finish(result, 'error', 'Git 历史输出超过 8 MiB 安全上限，未返回不完整的分页结果。');
  if (error.killed || error.code === 'HISTORY_TIMEOUT') return finish(result, 'error', '读取 Git 历史超时，未返回不完整的分页结果。');
  return finish(result, 'error', '无法读取 Git 历史，请检查本地仓库是否完整、可读。学习文件不受影响。');
}
function gitEnvironment(root) {
  const env = { ...process.env };
  // A server launched from another Git command must not inherit its repository.
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_SHALLOW_FILE']) delete env[name];
  env.GIT_CEILING_DIRECTORIES = dirname(root);
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  env.LC_ALL = 'C';
  return env;
}

/** Read-only view of this directory's current HEAD. Offset applies after kind filtering. */
export async function getGitHistory(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return finish(base(''), 'error', 'Git 历史参数须为对象。');
  const { root, learnerEmail: configured = process.env.LEARNER_GIT_EMAIL, kind = 'all', offset = 0, limit = 20, gitBin = 'git' } = options;
  const learnerEmail = normalizeEmail(configured);
  let result = base(learnerEmail);
  if (typeof root !== 'string' || !root || !isAbsolute(root) || root.includes('\0')) return finish(result, 'error', 'Git 历史目录须为有效的绝对路径。');
  if (!['all', 'learning', 'maintenance'].includes(kind) || !Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) return finish(result, 'error', '历史筛选或分页参数无效：kind 须为 all/learning/maintenance，offset 为非负整数，limit 为 1–100。');
  if (typeof gitBin !== 'string' || !gitBin || gitBin.includes('\0')) return finish(result, 'error', 'Git 可执行文件参数无效。');
  if (!validEmail(learnerEmail)) return finish(result, 'unconfigured', '学习者邮箱未配置或格式无效，请设置 LEARNER_GIT_EMAIL；不会将所有提交默认归为维护记录。');
  let directory;
  try { directory = await realpath(root); if (!(await stat(directory)).isDirectory()) throw new Error('not-directory'); }
  catch (_) { return finish(result, 'error', 'Git 历史目录不存在或不可读取。'); }

  const deadline = Date.now() + REQUEST_TIMEOUT;
  const env = gitEnvironment(directory);
  async function git(args) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Object.assign(new Error('history deadline'), { code: 'HISTORY_TIMEOUT' });
    return runFile(gitBin, PREFIX.concat(args), { cwd: directory, env, encoding: 'utf8', windowsHide: true, shell: false, timeout: Math.min(COMMAND_TIMEOUT, remaining), maxBuffer: MAX_OUTPUT });
  }
  try { await git(['rev-parse', '--git-dir']); }
  catch (error) {
    if (error.code === 128 && /not a git repository/i.test(error.stderr || '')) return finish(result, 'not-repository', '当前目录尚未初始化 Git 仓库；不会自动初始化或采集上级目录的历史。');
    return failure(result, error);
  }

  const [branchRead, shallowRead, headRead] = await Promise.allSettled([
    git(['symbolic-ref', '--quiet', 'HEAD']),
    git(['rev-parse', '--is-shallow-repository']),
    git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])
  ]);
  let branchRef = null;
  if (branchRead.status === 'fulfilled') {
    branchRef = branchRead.value.stdout.trim();
    if (!branchRef.startsWith('refs/')) return finish(result, 'error', 'Git 当前分支引用无效。');
    result.branch = branchRef.replace(/^refs\/heads\//, '');
  } else if (branchRead.reason.code !== 1) return failure(result, branchRead.reason);
  if (shallowRead.status === 'rejected') return failure(result, shallowRead.reason);
  const shallow = shallowRead.value.stdout.trim();
  if (!['true', 'false'].includes(shallow)) return finish(result, 'error', '无法确定 Git 历史是否完整。');
  result.shallow = shallow === 'true';
  if (headRead.status === 'rejected') {
    if (branchRef && headRead.reason.code === 1) {
      try { await git(['show-ref', '--verify', '--quiet', '--', branchRef]); }
      catch (error) {
        if (error.code === 1) return finish(result, 'empty', '当前分支尚无提交；保存或暂存文件不会自动产生 Git 历史。');
        return failure(result, error);
      }
    }
    return failure(result, headRead.reason);
  }
  result.head = headRead.value.stdout.trim();
  if (!HASH.test(result.head)) return finish(result, 'error', 'Git 当前 HEAD 不是有效的提交哈希。');

  let raw;
  try {
    // Pin to the resolved hash so a branch switch during this read cannot mix graphs.
    raw = (await git(['log', '--no-color', '--no-decorate', '--no-patch', '--no-show-signature', '--encoding=UTF-8', '-z', '--format=' + FORMAT, '--max-count=' + (MAX_COMMITS + 1), result.head, '--'])).stdout;
  } catch (error) { return failure(result, error); }
  const fields = raw.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (!fields.length || fields.length % 8 !== 0) return finish(result, 'error', 'Git 历史数据不完整，未返回部分记录。');
  if (fields.length / 8 > MAX_COMMITS) return finish(result, 'error', 'Git 历史超过 20,000 条安全读取上限，未返回不完整的分页结果。');
  const seen = new Set(), commits = [];
  for (let index = 0; index < fields.length; index += 8) {
    const [hash, subject, authorName, authorEmail, committerEmail, authorDate, committerDate, parents] = fields.slice(index, index + 8);
    if (!HASH.test(hash) || !Number.isFinite(Date.parse(authorDate)) || !Number.isFinite(Date.parse(committerDate)) || (parents && parents.split(' ').some(parent => !HASH.test(parent)))) return finish(result, 'error', 'Git 历史字段无效，未返回部分记录。');
    if (seen.has(hash)) continue;
    seen.add(hash);
    commits.push({ hash, shortHash: hash.slice(0, 12), subject, authorName, authorEmail, committerEmail, authorDate, committerDate, kind: normalizeEmail(authorEmail) === learnerEmail ? 'learning' : 'maintenance', merge: parents.split(' ').filter(Boolean).length > 1 });
  }
  commits.sort((a, b) => Date.parse(b.committerDate) - Date.parse(a.committerDate) || a.hash.localeCompare(b.hash));
  const matching = kind === 'all' ? commits : commits.filter(commit => commit.kind === kind);
  const items = matching.slice(offset, offset + limit);
  const hasMore = offset + items.length < matching.length;
  const qualifier = result.shallow ? '浅克隆：历史不完整。' : '';
  return { ...result, status: 'ok', message: qualifier + (items.length ? '按提交者时间展示当前 HEAD 可达的本地提交；作者时间保留在详情中。' : '当前筛选或分页范围内没有更多提交。'), items, hasMore, nextOffset: hasMore ? offset + items.length : null };
}
