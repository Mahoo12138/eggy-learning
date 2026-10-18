import './components/week-card.mjs';
import './components/notice.mjs';
import './components/comfort-controls.mjs';
import {
  $, $$, RANK_BLUEPRINTS, clamp, currentRank as blueprintCurrentRank, esc,
  formatCount, mergedRanks, mondayFor, playTone,
  progressPercent, requestJSON
} from './park-ui.mjs';
import { rankArtMarkup } from './rank-art.mjs';

const VIEWS = new Set(['lobby', 'map', 'honors', 'week']);
const state = {
  phase: 'loading',
  home: null,
  homeEtag: '',
  view: 'lobby',
};


function course() { return state.home?.course || state.home?.catalog || {}; }
function progress() { return state.home?.progress || state.home?.summary?.progress || state.home?.summary || {}; }
function learner() { return state.home?.learner || progress().learner || {}; }
function courseLevels() { return course().levels || state.home?.levels || []; }
function expandLevel(value) { return value?.content ? { ...value, ...value.content, id: value.id, title: value.title, rankId: value.rankId, locationId: value.locationId, estimatedMinutes: value.estimatedMinutes, version: value.version } : value; }
function courseLocations() { return course().locations || course().buildings || []; }
function locationFor(id) {
  const value = courseLocations().find(location => location.id === id);
  return value ? (value.title || value.name) : '';
}
function projectFor(id) { return (course().projects || []).find(project => project.id === id); }
function currentPointer() { return progress().current || {}; }
function currentLevel() {
  const supplied = state.home?.currentLevel || progress().currentLevel;
  if (supplied && typeof supplied === 'object') return expandLevel(supplied);
  const id = supplied || currentPointer().activityId || currentPointer().levelId || progress().currentLevelId;
  return expandLevel(courseLevels().find(level => level.id === id)) || null;
}

function nextMasteryLevel(rankId) {
  const chapters = courseLevels().filter(level => level.rankId === rankId && level.kind === 'interactive-lesson');
  const completed = new Set((progress().attempts || []).filter(item => item.kind === 'level' && item.result?.levelCompleted).map(item => item.payload.levelId));
  if (!chapters.length || !chapters.every(chapter => completed.has(chapter.id))) return null;
  const starred = new Set((progress().awardLedger || []).filter(item => item.kind === 'star').map(item => item.activityId));
  return chapters.find(chapter => !starred.has(chapter.id)) || null;
}

function normalizeRanks() {
  const rankStates = progress().rankStates || [];
  const completedIds = new Set((progress().attempts || []).filter(attempt => attempt.result?.levelCompleted || attempt.result?.checkpointCompleted && attempt.payload?.checkpointId?.includes('boss')).map(attempt => attempt.payload?.levelId || attempt.payload?.projectId).filter(Boolean));
  const currentId = currentPointer().rankId || progress().rankId || state.home?.currentRank?.id || 'quail';
  const rawRanks = (course().ranks || state.home?.ranks || []).map((rank, index) => {
    const rankState = rankStates.find(value => value.rankId === rank.id) || {};
    const blueprint = RANK_BLUEPRINTS.find(value => value.id === rank.id) || RANK_BLUEPRINTS[index];
    const locationIds = rank.locationIds || (rank.buildingId ? [rank.buildingId] : []);
    const project = projectFor(rank.projectId);
    const hasProject = Boolean(project || rank.projectId);
    const total = rank.activityIds?.length || rank.levelIds?.length || courseLevels().filter(level => level.rankId === rank.id).length || 1;
    const completed = rankState.completedActivities ?? rankState.completedLevels ?? courseLevels().filter(level => level.rankId === rank.id && completedIds.has(level.id)).length;
    let status = rankState.status;
    if (status === 'available') status = rank.id === currentId ? 'current' : 'available';
    if (!status) status = rank.id === currentId ? 'current' : index < Math.max(0, (course().ranks || []).findIndex(item => item.id === currentId)) ? 'completed' : 'locked';
    return {
      id: rank.id,
      name: rank.title || rank.name || blueprint?.name,
      title: rank.title || rank.name || blueprint?.name,
      domain: rank.technologyTheme || (Array.isArray(rank.technology) ? rank.technology.join(' · ') : rank.technology) || blueprint?.domain,
      building: locationIds.map(locationFor).filter(Boolean).join(' · ') || (hasProject ? blueprint?.building : ''),
      summary: rank.summary || project?.pitch || blueprint?.summary,
      project: project?.title || (hasProject ? blueprint?.project : ''),
      reward: rank.token?.title || blueprint?.reward,
      status,
      locked: status === 'locked',
      progressPercent: rankState.progressPercent ?? (status === 'completed' ? 100 : total ? completed / total * 100 : 0),
      earnedStars: rankState.earnedStars ?? 0,
      performancePoints: rankState.performancePoints ?? 0,
      order: rank.order || index + 1
    };
  });
  return rawRanks.length ? rawRanks : mergedRanks({ ...state.home, progress: { ...progress(), rankId: currentId } });
}

function xpState() {
  const source = progress().xp || {};
  if (typeof source === 'number') return { total: source, level: progress().level || 1, current: source, target: progress().nextLevelXp || 100 };
  return {
    total: Number(source.total ?? progress().xpTotal ?? 0),
    level: Number(source.level ?? progress().level ?? 1),
    current: Number(source.currentLevelXp ?? source.current ?? 0),
    target: Number(source.nextLevelXp ?? source.target ?? 100)
  };
}

function activeWeek() {
  const source = state.home?.weekCard || {};
  if (source.weekStart) return source;
  const current = mondayFor();
  return (source.weeks || []).find(week => week.weekStart === current) || (source.weeks || []).at(-1) || null;
}

function achievementRecords() {
  const definitions = course().achievements || [];
  const wall = progress().achievementWall || {};
  const earnedRaw = state.home?.achievements || wall.earned || [];
  const earnedIds = new Set(earnedRaw.map(value => typeof value === 'string' ? value : value.id || value.achievementId));
  const awardLedger = progress().awardLedger || [];
  for (const award of awardLedger) if (award.achievementId) earnedIds.add(award.achievementId);
  return definitions.map(definition => ({
    ...definition,
    earned: earnedIds.has(definition.id),
    earnedAt: earnedRaw.find(value => typeof value === 'object' && (value.id === definition.id || value.achievementId === definition.id))?.earnedAt || ''
  }));
}

function rewardRecords() {
  const definitions = course().rewardCatalog || [];
  const ledger = progress().awardLedger || [];
  return definitions.map(definition => ({
    ...definition,
    earned: ledger.some(entry => entry.rankId === definition.sourceRankId && entry.kind === definition.kind),
    earnedAt: ledger.find(entry => entry.rankId === definition.sourceRankId && entry.kind === definition.kind)?.earnedAt || ''
  }));
}

function allCollections() {
  return [
    ...rewardRecords().map(item => ({ ...item, collectionType: item.kind?.includes('trophy') ? '作品战利品' : '能力信物' })),
    ...achievementRecords().map(item => ({ ...item, collectionType: '成就徽章' }))
  ];
}

function recentReward() {
  const direct = state.home?.recentReward;
  if (direct) return direct;
  const ledger = progress().awardLedger || [];
  const latest = ledger.at(-1);
  if (!latest) return null;
  const definition = (course().rewardCatalog || []).find(item => [latest.rewardId, latest.catalogId, latest.id].includes(item.id));
  return { ...definition, ...latest, title: definition?.title || latest.title };
}

function setPhase(phase, message = '') {
  state.phase = phase;
  $('#loading-view').hidden = phase !== 'loading';
  $('#error-view').hidden = phase !== 'error';
  if (message) $('#error-message').textContent = message;
  renderRoute();
}

function showNotice(message, kind = 'info') { $('#app-notice').show(message, { kind }); }

function routeFromHash() {
  const next = location.hash.slice(1).split('?')[0];
  return VIEWS.has(next) ? next : 'lobby';
}

function renderRoute() {
  state.view = routeFromHash();
  const hasData = state.phase === 'ready' && state.home;
  const level = hasData ? currentLevel() : null;
  const lobbyEmpty = hasData && state.view === 'lobby' && !level;
  $('#empty-view').hidden = !lobbyEmpty;
  $$('.app-view').forEach(view => { view.hidden = !hasData || lobbyEmpty || view.id !== `view-${state.view}`; });
  $$('[data-route]').forEach(link => link.setAttribute('aria-current', link.dataset.route === state.view ? 'page' : 'false'));
  if (hasData && !lobbyEmpty) {
    if (state.view === 'lobby') renderLobby();
    if (state.view === 'map') renderMap();
    if (state.view === 'honors') renderHonors();
    if (state.view === 'week') renderWeek();
  }
}

function renderHeader() {
  const rank = normalizeRanks().find(item => item.status === 'current') || blueprintCurrentRank(state.home || {});
  const xp = xpState();
  const stars = normalizeRanks().reduce((sum, item) => sum + Number(item.earnedStars || 0), 0);
  $('.hud-rank-art').innerHTML = rankArtMarkup(rank?.id, { eager: true });
  $('.hud-rank').textContent = rank?.name || '待定段位';
  $('#player-hud').setAttribute('aria-label', `当前段位：${rank?.name || '待定段位'}，等级 ${xp.level}，${stars} 颗星`);
  $('.hud-level').textContent = `Lv. ${xp.level}`;
  $('.hud-stars').textContent = `${stars} 星`;
  $('.hud-stars').setAttribute('aria-label', `${stars} 颗星`);
}

function renderLobby() {
  const level = currentLevel();
  const ranks = normalizeRanks();
  const rank = ranks.find(item => item.status === 'current') || ranks[0];
  const xp = xpState();
  const percent = progressPercent({ xp: xp.current, nextLevelXp: xp.target });
  const projectMode = level?.activityType === 'rank-project' || Array.isArray(level?.chapters);
  const location = (level?.locationIds || []).map(locationFor).filter(Boolean).join(' · ') || rank?.building || '乐园项目区';
  const objectives = Array.isArray(level?.objectives) ? level.objectives.join('；') : '';
  const trainingSummary = objectives || level?.summary || level?.description || level?.scene?.intro || rank?.summary || '先预测，再运行，用实际结果修正自己的解释。';
  const displayName = learner().displayName || learner().name || '学习者';
  const reward = recentReward();
  const hasStarted = (progress().attempts || []).some(attempt => (attempt.payload?.levelId === level?.id || attempt.payload?.projectId === level?.id)
    && attempt.payload?.contentVersion === level?.version);

  $('#hero-welcome').textContent = `${displayName}，欢迎回到蛋仔岛`;
  $('#lobby-title').textContent = level ? `${projectMode ? '继续作品' : '继续训练'}：${level.title}` : '今天先看看段位地图';
  $('#hero-summary').textContent = projectMode ? (level?.story || trainingSummary) : trainingSummary;
  $('#continue-link').href = `/play.html?level=${encodeURIComponent(level?.id || '')}`;
  $('#continue-link').textContent = hasStarted ? '继续游玩' : '开始这一关';
  const mastery = nextMasteryLevel(rank?.id);
  if (mastery) {
    $('#lobby-title').textContent = `补齐独立星星：${mastery.title}`;
    $('#hero-summary').textContent = '本段章节练习已完成。直接挑战未看答案的等价题，每章独立通过获得一颗星，补齐后进入 Boss。';
    $('#continue-link').href = `/play.html?level=${encodeURIComponent(mastery.id)}&practice=mastery`;
    $('#continue-link').textContent = '进入补星挑战';
  }
  $('#continue-meta').textContent = mastery ? '直接进入独立练习 · 无需重做已完成步骤' : `${level?.estimatedMinutes || course().learningPolicy?.lessonMinutes?.typical || 20} 分钟 · 每一步自动记录`;
  $('#hero-reward').innerHTML = `<span class="reward-mark" aria-hidden="true"></span><span><small>最近获得</small><strong>${esc(reward?.title || '还没有收藏')}</strong></span>`;

  $('#rank-emblem').innerHTML = rankArtMarkup(rank?.id, { eager: true });
  $('#current-rank-name').textContent = rank?.name || '鹌鹑蛋';
  $('#current-rank-domain').textContent = rank?.domain || 'C 程序如何运行';
  $('#xp-label').textContent = `${formatCount(xp.current)} / ${formatCount(xp.target)} XP`;
  $('#xp-bar').style.width = `${percent}%`;
  $('#xp-bar').parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));
  $('#rank-progress-note').textContent = rank?.earnedStars
    ? `本段位已获得 ${rank.earnedStars} 颗星。继续完成首次独立变式，再去挑战 Boss。`
    : '练习获得经验，首次独立完成变式获得星星。';

  $('.current-place').dataset.mode = projectMode ? 'project' : 'level';
  $('.current-place .section-label').textContent = projectMode ? '当前项目' : '当前训练';
  $('#current-place-title').textContent = projectMode ? (level?.title || location) : (level?.title || rank?.domain || '在线互动训练');
  $('#current-place-copy').textContent = projectMode ? (level?.story || rank?.summary || '逐章完成作品，并留下可复现的运行证据。') : trainingSummary;

  const week = activeWeek();
  const rest = week?.mode === 'rest';
  const playDays = rest ? 0 : Number(week?.playDays || state.home?.weekCard?.preferences?.normalPlayCount || 0);
  $('#week-preview-title').textContent = rest ? '这周安心休息' : playDays ? `这周计划游玩 ${playDays} 次` : '按真实时间游玩';
  $('#week-preview-copy').textContent = rest ? '没有补课和欠课，下次直接从当前步骤继续。' : week?.note || '选一个主目标和一关短练习，留一点余量给真正的生活。';
  $('#week-dots').innerHTML = Array.from({ length: Math.max(4, playDays) }, (_, index) => `<span class="${index < playDays ? 'active' : ''}" aria-hidden="true"></span>`).join('');

  const earnedCount = allCollections().filter(item => item.earned).length;
  $('#trophy-preview-copy').textContent = earnedCount ? `已经收藏 ${earnedCount} 件荣誉。它们不会因重试或休息被取消。` : '能力信物、Boss 信物和作品战利品会永久保留。';
}

function rankStatusLabel(rank) {
  if (rank.status === 'completed') return '已通关';
  if (rank.status === 'current' || rank.status === 'available') return rank.earnedStars ? `${rank.earnedStars} 星` : '正在游玩';
  return '尚未解锁';
}

function renderMap() {
  const level = currentLevel();
  const ranks = normalizeRanks();
  $('#rank-route').innerHTML = ranks.map(rank => {
    const playable = !rank.locked && (rank.status === 'current' || rank.status === 'available') && level?.rankId === rank.id;
    const title = rank.project
      ? `${esc(rank.summary)}<span class="rank-building">段位作品：${esc(rank.project)}</span>`
      : `${esc(rank.summary)}<span class="rank-building">通关方式：在线互动题与综合挑战</span>`;
    const definition = (course().ranks || []).find(item => item.id === rank.id);
    const completed = new Set((progress().attempts || []).filter(item => item.kind === 'level' && item.result?.levelCompleted).map(item => item.payload.levelId));
    const starred = new Set((progress().awardLedger || []).filter(item => item.kind === 'star').map(item => item.activityId));
    const requiredStars = definition?.promotion?.requiredStars || 0;
    const mastery = nextMasteryLevel(rank.id);
    const primaryHref = mastery ? `/play.html?level=${encodeURIComponent(mastery.id)}&practice=mastery` : `/play.html?level=${encodeURIComponent(level?.id || '')}`;
    const chapterLinks = !rank.locked && !definition?.projectId ? (definition?.activityIds || []).map(id => {
      const chapter = courseLevels().find(item => item.id === id);
      if (!chapter) return '';
      const boss = chapter.kind === 'rank-boss';
      const available = (chapter.prerequisiteLevelIds || []).every(id => completed.has(id)) && (!boss || rank.earnedStars >= requiredStars);
      const done = completed.has(id), star = starred.has(id);
      const action = boss ? '进入 Boss' : done && !star ? '补星挑战' : done ? '回顾练习' : '开始练习';
      const href = `/play.html?level=${encodeURIComponent(id)}${done && !star && !boss ? '&practice=mastery' : ''}`;
      return `<li><div><strong>${esc(chapter.title)}</strong><small>${boss ? available ? 'Boss 已解锁' : `Boss 需 ${requiredStars} 星，当前 ${rank.earnedStars} 星` : star ? '已获得独立星星' : done ? '练习已完成 · 独立星星待获得' : '尚未完成'}</small></div>${available ? `<a class="text-link" href="${href}">${action}</a>` : '<span class="rank-status-label">待解锁</span>'}</li>`;
    }).join('') : '';
    return `<li class="rank-route-item"><article class="rank-card" data-status="${esc(rank.status)}">
      <div class="rank-card-egg" aria-hidden="true">${rankArtMarkup(rank.id)}</div>
      <div><h2>${esc(rank.name)}</h2><h3>${esc(rank.domain)}</h3><p>${title}</p>
      <div class="rank-card-foot"><div class="rank-mini-progress" aria-hidden="true"><span></span></div><span class="rank-status-label">${esc(rankStatusLabel(rank))}</span>${playable ? `<a class="text-link" href="${primaryHref}">${mastery ? '补齐独立星星' : '继续游玩'}</a>` : ''}</div>${chapterLinks ? `<ul class="mastery-chapter-list" aria-label="${esc(rank.name)}章节与独立星星">${chapterLinks}</ul>` : ''}</div>
    </article></li>`;
  }).join('');
  $$('#rank-route .rank-mini-progress span').forEach((bar, index) => {
    bar.style.width = `${clamp(ranks[index].progressPercent)}%`;
  });
}

function collectionSymbol(item) {
  if (item.collectionType === '成就徽章') return '★';
  if (item.kind?.includes('trophy')) return '◆';
  return '●';
}

function renderHonors() {
  const rank = normalizeRanks().find(item => item.status === 'current') || normalizeRanks()[0];
  $('#honor-current').innerHTML = `<div class="rank-emblem" aria-hidden="true">${rankArtMarkup(rank?.id, { eager: true })}</div><h2>${esc(rank?.name || '鹌鹑蛋')}</h2><p>${esc(rank?.domain || '')}</p>`;
  const collections = allCollections();
  const visible = collections.filter(item => item.earned || item.hidden !== true);
  const lockedFallback = visible.length ? [] : [
    { id: 'locked-1', title: '第一件能力信物', description: '完成首个段位 Boss 后解锁。' },
    { id: 'locked-2', title: '第一件作品战利品', description: '从鹅蛋段位开始，作品会陈列在这里。' }
  ];
  $('#honor-wall').innerHTML = [...visible, ...lockedFallback].map(item => {
    const earned = item.earned === true;
    const date = item.earnedAt ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(item.earnedAt)) : '';
    return `<article class="honor-item"${earned ? '' : ' aria-disabled="true"'}><div class="honor-symbol" aria-hidden="true">${earned ? collectionSymbol(item) : '?'}</div><h3>${esc(item.title || '待解锁收藏')}</h3><p>${esc(item.description || (earned ? item.collectionType : '继续游玩后显示获得条件。'))}</p>${earned ? `<span class="honor-meta">${esc(item.collectionType || '荣誉收藏')}${date ? ` · ${esc(date)}` : ''}</span>` : ''}</article>`;
  }).join('');
}

function renderWeek() {
  const source = state.home?.weekCard || {};
  $('#week-editor').model = {
    course: course(), rankId: normalizeRanks().find(item => item.status === 'current')?.id || '',
    week: { ...source, ...activeWeek(), weekStart: activeWeek()?.weekStart || mondayFor() },
    learnerId: learner().id || source.learnerId || 'learner-1'
  };
}

$('#week-editor').save = async payload => {
  const response = await requestJSON('/api/play/week-card', { method: 'PUT', body: JSON.stringify(payload) });
  return response.data.weekCard || response.data;
};
$('#week-editor').addEventListener('week-saved', event => {
  state.home.weekCard = event.detail.weekCard;
  playTone('success'); renderLobby();
});

async function loadHome() {
  setPhase('loading');
  try {
    const response = await requestJSON('/api/play/home');
    state.home = response.data;
    state.homeEtag = response.etag;
    setPhase('ready');
    renderHeader();
    renderRoute();
  } catch (error) {
    setPhase('error', error.message);
  }
}

window.addEventListener('hashchange', renderRoute);
document.addEventListener('click', event => {
  const target = event.target.closest('[data-route-target]');
  if (target) location.hash = target.dataset.routeTarget;
});
$('#retry-home').addEventListener('click', loadHome);

loadHome();
