import { rankArtMarkup } from './rank-art.mjs';

const route = document.getElementById('rank-route');
const detail = document.getElementById('rank-detail');
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let home;

const levelsFor = rank => (home?.course?.levels || []).filter(level => level.rankId === rank.id);
const modeFor = rank => !rank.projectId ? 'interactive' : rank.order === 9 ? 'capstone' : 'project';
const modeLabel = rank => ({ interactive: '在线互动', project: '阶段作品', capstone: '独立综合' })[modeFor(rank)];

function selectRank(id) {
  const rank = home.course.ranks.find(item => item.id === id);
  if (!rank) return;
  route.querySelectorAll('.rank-node').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id === id)));
  const levels = levelsFor(rank);
  const project = home.course.projects?.find(item => item.id === rank.projectId);
  const reward = home.course.rewardCatalog?.find(item => item.sourceRankId === rank.id);
  const venueNames = (rank.locationIds || []).map(locationId => home.course.locations?.find(item => item.id === locationId)?.title).filter(Boolean);
  const trainingLabel = project ? '项目背景' : '训练形式';
  const trainingValue = project ? (venueNames.join('、') || '整座蛋仔岛') : '在线互动题与综合挑战';
  const contentRows = levels.length
    ? levels.map((level, index) => `<div class="level-row"><span>${String(index + 1).padStart(2, '0')} · ${esc(level.title)}</span><span>${esc(level.kind === 'rank-boss' ? 'BOSS' : `${level.estimatedMinutes || 20} 分钟`)}</span></div>`).join('')
    : (project?.chapters || []).map((chapter, index) => `<div class="level-row"><span>${String(index + 1).padStart(2, '0')} · ${esc(chapter.title)}</span><span>章节</span></div>`).join('') + (project?.boss ? `<div class="level-row"><span>BOSS · ${esc(project.boss.title)}</span><span>综合挑战</span></div>` : '');
  detail.innerHTML = `<div class="rank-detail-grid"><div><div class="rank-detail-heading"><span class="rank-detail-art" aria-hidden="true">${rankArtMarkup(rank.id, { eager: true })}</span><div><span class="label">第 ${esc(rank.order)} 个段位 · ${esc(modeLabel(rank))}</span><h2>${esc(rank.title)}</h2><p>${esc(rank.technologyTheme)}</p></div></div><div class="rank-meta"><div><span>技术主题</span><strong>${esc(rank.technologyTheme)}</strong></div><div><span>${trainingLabel}</span><strong>${esc(trainingValue)}</strong></div><div><span>晋段成果</span><strong>${esc(project?.title || reward?.title || '能力信物')}</strong></div><div><span>学习内容</span><strong>${esc(levels.length || project?.chapters?.length || 0)} 个关卡或章节</strong></div></div></div><div><span class="label">关卡与章节</span><div class="level-list">${contentRows || '<div class="level-row"><span>课程内容正在准备</span><span>已规划</span></div>'}</div></div></div>`;
  detail.hidden = false;
  detail.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function load() {
  try {
    const response = await fetch('/api/play/home', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '课程读取失败');
    home = data;
    route.innerHTML = home.course.ranks.map(rank => `<button class="rank-node" type="button" data-id="${esc(rank.id)}" aria-pressed="false"><span class="rank-egg" aria-hidden="true">${rankArtMarkup(rank.id)}</span><span><small>${esc(modeLabel(rank))}</small><strong>${esc(rank.title)}</strong><p>${esc(rank.technologyTheme)}</p></span></button>`).join('');
    route.addEventListener('click', event => { const button = event.target.closest('.rank-node'); if (button) selectRank(button.dataset.id); });
  } catch (error) {
    route.innerHTML = `<div class="loading-card"><strong>段位地图暂时没有加载成功</strong><p>${esc(error.message)}。请确认本地服务正在运行后刷新。</p></div>`;
  }
}

load();
