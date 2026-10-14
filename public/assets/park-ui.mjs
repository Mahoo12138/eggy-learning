export const RANK_BLUEPRINTS = [
  { id: 'quail', name: '鹌鹑蛋', short: 'C 程序基础', domain: 'C 基础、流程控制与函数', building: '', summary: '从完整程序和可靠输入开始，用分支、循环与函数处理批量数据。', reward: 'C 程序通行证' },
  { id: 'pigeon', name: '鸽子蛋', short: '数据与资源', domain: 'C 数据结构、指针、内存与文件', building: '', summary: '用数组和结构体组织记录，管理动态内存，并把数据可靠写入文件。', reward: '内存与文件芯片' },
  { id: 'chicken', name: '鸡蛋', short: 'Linux 入门', domain: 'Linux 系统与终端基础', building: '', summary: '认识内核、Shell 和进程，在目录树中组合权限、重定向与管道。', reward: 'Linux 终端徽章' },
  { id: 'goose', name: '鹅蛋', short: '内存与数据组织', domain: 'C 数组、字符串、指针与文件', building: '苹果派雪雪烘焙店 · 淘气丸子奶茶店', summary: '把零散数据放进可靠的内存与文件结构。', reward: '美食街奖杯', project: '蛋仔食堂·今天吃什么' },
  { id: 'ostrich', name: '鸵鸟蛋', short: '嵌入式机关', domain: 'STM32 与外设', building: '巨型摩天轮', summary: '用按键、定时器、中断和传感器守住设备安全。', reward: '摩天轮控制钥匙', project: '蛋仔摩天轮安全中控站' },
  { id: 'dinosaur', name: '恐龙蛋', short: '进程调度', domain: 'Linux 进程与系统接口', building: '中央喷泉夜间总控台', summary: '让多个进程协作，也能在故障时安全退出。', reward: '夜班巡检徽章', project: '蛋仔岛夜班巡检台' },
  { id: 'peak-phoenix', name: '巅峰凤凰蛋', short: '并发协作', domain: 'C++ 线程、同步与资源管理', building: '商城建筑 · 道具仓库', summary: '让多个工作线程安全处理订单与共享库存。', reward: '配送中心印章', project: '蛋仔商城道具配送中心' },
  { id: 'super-phoenix', name: '超级凤凰蛋', short: '联机数据', domain: 'C 网络 + C++ / SQL / SQLite', building: '游戏厅 · 联网终端', summary: '接收、去重、持久化并查询乐园比赛事件。', reward: '全岛联机信标', project: '蛋仔游戏厅联机积分中心' },
  { id: 'invincible-phoenix', name: '无敌凤凰蛋', short: '独立整合', domain: '跨系统设计与故障恢复', building: '整座蛋仔岛', summary: '独立定义问题、连接系统，并让作品经得起异常。', reward: '无敌凤凰冠冕', project: '学习者自主设计的毕业作品' }
];

const PREF_KEY = 'eggy-code-park-comfort-v1';
let audioContext;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const clamp = (value, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
export const makeRequestId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

export class RequestError extends Error {
  constructor(message, status = 0, code = 'request_failed') {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
  }
}

export async function requestJSON(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });
    let data;
    try { data = await response.json(); }
    catch { throw new RequestError(`服务器返回了无法读取的内容（${response.status}）`, response.status, 'invalid_response'); }
    if (!response.ok) throw new RequestError(data?.error || `请求失败（${response.status}）`, response.status, data?.code);
    return { data, etag: response.headers.get('ETag') || '' };
  } catch (error) {
    if (error.name === 'AbortError') throw new RequestError('连接超时，这次操作未确认完成。', 0, 'timeout');
    if (error instanceof RequestError) throw error;
    throw new RequestError('无法连接学习服务，请确认服务已启动后重试。', 0, 'network_error');
  } finally {
    clearTimeout(timer);
  }
}

export function readComfort() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch {}
  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    muted: saved.muted === true,
    reducedMotion: typeof saved.reducedMotion === 'boolean' ? saved.reducedMotion : systemReduced
  };
}

export function applyComfort(preferences) {
  document.documentElement.dataset.motion = preferences.reducedMotion ? 'reduced' : 'full';
  document.documentElement.dataset.sound = preferences.muted ? 'muted' : 'on';
  $$('[data-comfort="sound"]').forEach(button => {
    button.setAttribute('aria-pressed', String(preferences.muted));
    const label = preferences.muted ? '声音已关' : '声音已开';
    button.title = `${label}，点击${preferences.muted ? '开启' : '静音'}`;
    $('[data-comfort-label]', button)?.replaceChildren(label);
  });
  $$('[data-comfort="motion"]').forEach(button => {
    button.setAttribute('aria-pressed', String(preferences.reducedMotion));
    const label = preferences.reducedMotion ? '减少动效' : '标准动效';
    button.title = `${label}，点击切换`;
    $('[data-comfort-label]', button)?.replaceChildren(label);
  });
}

export function initComfortControls(root = document) {
  const preferences = readComfort();
  applyComfort(preferences);
  root.addEventListener('click', event => {
    const button = event.target.closest('[data-comfort]');
    if (!button) return;
    if (button.dataset.comfort === 'sound') preferences.muted = !preferences.muted;
    if (button.dataset.comfort === 'motion') preferences.reducedMotion = !preferences.reducedMotion;
    try { localStorage.setItem(PREF_KEY, JSON.stringify(preferences)); } catch {}
    applyComfort(preferences);
    if (!preferences.muted) playTone('tap');
  });
  return preferences;
}

export function playTone(kind = 'success') {
  if (readComfort().muted) return;
  try {
    audioContext ||= new AudioContext();
    const now = audioContext.currentTime;
    const notes = kind === 'success' ? [523.25, 659.25, 783.99] : kind === 'reward' ? [392, 523.25, 659.25, 783.99] : [440];
    notes.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + index * .08);
      gain.gain.exponentialRampToValueAtTime(.055, now + index * .08 + .015);
      gain.gain.exponentialRampToValueAtTime(.0001, now + index * .08 + .14);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now + index * .08);
      oscillator.stop(now + index * .08 + .16);
    });
  } catch {}
}

export async function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器没有允许复制。');
}

export function rankBlueprint(id, fallbackIndex = 0) {
  const normalized = String(id || '').toLowerCase();
  return RANK_BLUEPRINTS.find(rank => rank.id === normalized || rank.name === id) || RANK_BLUEPRINTS[clamp(fallbackIndex, 0, RANK_BLUEPRINTS.length - 1)];
}

export function mergedRanks(home = {}) {
  const remote = Array.isArray(home.ranks) ? home.ranks : [];
  const progress = home.progress || {};
  const currentId = progress.rankId || progress.currentRankId || home.currentRank?.id || remote.find(rank => rank.status === 'current')?.id || RANK_BLUEPRINTS[0].id;
  const currentIndex = Math.max(0, RANK_BLUEPRINTS.findIndex(rank => rank.id === currentId));
  return RANK_BLUEPRINTS.map((blueprint, index) => {
    const source = remote.find(rank => rank.id === blueprint.id || rank.name === blueprint.name) || {};
    const percent = source.progressPercent ?? source.percent ?? (source.completed ? 100 : index < currentIndex ? 100 : 0);
    return {
      ...blueprint,
      ...source,
      name: source.name || blueprint.name,
      domain: source.domain || source.theme || blueprint.domain,
      building: source.building || blueprint.building,
      summary: source.summary || blueprint.summary,
      progressPercent: clamp(percent),
      status: source.status || (index < currentIndex ? 'completed' : index === currentIndex ? 'current' : 'locked'),
      locked: typeof source.locked === 'boolean' ? source.locked : index > currentIndex
    };
  });
}

export function currentRank(home = {}) {
  const ranks = mergedRanks(home);
  return ranks.find(rank => rank.status === 'current') || ranks.find(rank => !rank.locked && rank.progressPercent < 100) || ranks.at(-1);
}

export function progressPercent(progress = {}) {
  if (Number.isFinite(progress.xpPercent)) return clamp(progress.xpPercent);
  const current = Number(progress.xp ?? progress.experience ?? 0);
  const target = Number(progress.nextLevelXp ?? progress.xpToNextLevel ?? progress.levelXpTarget ?? 100);
  return target > 0 ? clamp(current / target * 100) : 0;
}

export function formatCount(value) {
  return new Intl.NumberFormat('zh-CN').format(Number(value) || 0);
}

export function mondayFor(date = new Date()) {
  const value = new Date(date);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const localDay = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${localDay}`;
}

export function buildAIContext({ level, step, answer, feedback, hintLevel = 0 }) {
  const learningGoal = Array.isArray(level?.objectives) && level.objectives.length
    ? level.objectives.join('；')
    : level?.goal || level?.summary || level?.technologyTheme || '观察程序行为并解释原因';
  const lines = [
    '你是我的编程学习导师。请先用问题引导我观察和定位，不要直接给完整答案。',
    '',
    `当前关卡：${level?.title || level?.name || level?.id || '未命名关卡'}`,
    `学习目标：${learningGoal}`,
    `当前步骤：${step?.title || step?.prompt || step?.id || '未命名步骤'}`,
    `我已查看的提示层级：${hintLevel}`,
    '',
    '我的作答或代码：',
    String(answer || '（还没有作答）'),
    '',
    '当前运行或检查结果：',
    String(feedback?.actualOutput || feedback?.output || feedback?.message || '（还没有运行结果）'),
    '',
    '请按这个顺序帮助我：1. 让我说出预测；2. 指出应观察的变量或代码区域；3. 用一个更小的问题引导我自己修改；4. 最后让我用新变式检查是否真正理解。'
  ];
  return lines.join('\n');
}
