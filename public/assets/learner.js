import {
  $, $$, RANK_BLUEPRINTS, clamp, currentRank as blueprintCurrentRank, esc,
  formatCount, initComfortControls, mergedRanks, mondayFor, playTone,
  progressPercent, requestJSON
} from './park-ui.mjs';

const VIEWS = new Set(['lobby', 'map', 'honors', 'week']);
const state = {
  phase: 'loading',
  home: null,
  homeEtag: '',
  view: 'lobby',
  noticeTimer: null,
  weekSaving: false
};

initComfortControls();

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

function normalizeRanks() {
  const rankStates = progress().rankStates || [];
  const completedIds = new Set((progress().attempts || []).filter(attempt => attempt.result?.levelCompleted || attempt.result?.checkpointCompleted && attempt.payload?.checkpointId?.includes('boss')).map(attempt => attempt.payload?.levelId || attempt.payload?.projectId).filter(Boolean));
  const currentId = currentPointer().rankId || progress().rankId || state.home?.currentRank?.id || 'quail';
  const rawRanks = (course().ranks || state.home?.ranks || []).map((rank, index) => {
    const rankState = rankStates.find(value => value.rankId === rank.id) || {};
    const blueprint = RANK_BLUEPRINTS.find(value => value.id === rank.id) || RANK_BLUEPRINTS[index];
    const locationIds = rank.locationIds || (rank.buildingId ? [rank.buildingId] : []);
    const project = projectFor(rank.projectId);
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
      building: locationIds.map(locationFor).filter(Boolean).join(' · ') || blueprint?.building,
      summary: rank.summary || project?.pitch || blueprint?.summary,
      project: project?.title || blueprint?.project,
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

function showNotice(message, kind = 'info') {
  const element = $('#app-notice');
  clearTimeout(state.noticeTimer);
  element.textContent = message;
  element.dataset.kind = kind;
  element.hidden = !message;
  if (message) state.noticeTimer = setTimeout(() => { element.hidden = true; }, 4600);
}

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
  $('.hud-rank').textContent = rank?.name || '待定段位';
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
  const location = locationFor(level?.locationId || level?.scene?.locationId) || rank?.building || '乐园待开放区域';
  const displayName = learner().displayName || learner().name || '学习者';
  const reward = recentReward();
  const hasStarted = (progress().attempts || []).some(attempt => attempt.payload?.levelId === level?.id || attempt.payload?.projectId === level?.id);

  $('#hero-welcome').textContent = `${displayName}，欢迎回到蛋仔岛`;
  $('#lobby-title').textContent = level ? `从${location}继续` : '今天先看看乐园地图';
  $('#hero-summary').textContent = level?.scene?.intro || level?.summary || level?.description || '今天只做好一个小步骤：先预测，再运行，最后说清原因。';
  $('#continue-link').href = `/play.html?level=${encodeURIComponent(level?.id || '')}`;
  $('#continue-link').textContent = hasStarted ? '继续游玩' : '开始这一关';
  $('#continue-meta').textContent = `${level?.estimatedMinutes || course().learningPolicy?.lessonMinutes?.typical || 20} 分钟 · 每一步自动记录`;
  $('#hero-reward').innerHTML = `<span class="reward-mark" aria-hidden="true"></span><span><small>最近获得</small><strong>${esc(reward?.title || '还没有收藏')}</strong></span>`;

  $('#rank-emblem span').textContent = rank?.order || 1;
  $('#current-rank-name').textContent = rank?.name || '鹌鹑蛋';
  $('#current-rank-domain').textContent = rank?.domain || 'C 程序如何运行';
  $('#xp-label').textContent = `${formatCount(xp.current)} / ${formatCount(xp.target)} XP`;
  $('#xp-bar').style.width = `${percent}%`;
  $('#xp-bar').parentElement.setAttribute('aria-valuenow', String(Math.round(percent)));
  $('#rank-progress-note').textContent = rank?.earnedStars
    ? `本段位已获得 ${rank.earnedStars} 颗星。继续完成首次独立变式，再去挑战 Boss。`
    : '练习获得经验，首次独立完成变式获得星星。';

  $('#current-place-title').textContent = location;
  $('#current-place-copy').textContent = level?.scene?.intro || rank?.summary || '程序执行一步，场景就响应一步。';

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
  $('#rank-route').innerHTML = normalizeRanks().map((rank, index) => {
    const playable = !rank.locked && (rank.status === 'current' || rank.status === 'available') && level?.rankId === rank.id;
    const title = rank.project ? `${esc(rank.summary)}<span class="rank-building">段位作品：${esc(rank.project)}</span>` : `${esc(rank.summary)}<span class="rank-building">场景：${esc(rank.building)}</span>`;
    return `<li class="rank-route-item"><article class="rank-card" data-status="${esc(rank.status)}">
      <div class="rank-card-egg" aria-hidden="true">${index + 1}</div>
      <div><h2>${esc(rank.name)}</h2><h3>${esc(rank.domain)}</h3><p>${title}</p>
      <div class="rank-card-foot"><div class="rank-mini-progress" aria-hidden="true"><span style="width:${clamp(rank.progressPercent)}%"></span></div><span class="rank-status-label">${esc(rankStatusLabel(rank))}</span>${playable ? `<a class="text-link" href="/play.html?level=${encodeURIComponent(level.id)}">继续游玩</a>` : ''}</div></div>
    </article></li>`;
  }).join('');
}

function collectionSymbol(item) {
  if (item.collectionType === '成就徽章') return '★';
  if (item.kind?.includes('trophy')) return '◆';
  return '●';
}

function renderHonors() {
  const rank = normalizeRanks().find(item => item.status === 'current') || normalizeRanks()[0];
  $('#honor-current').innerHTML = `<div class="rank-emblem" aria-hidden="true"><span>${esc(rank?.order || 1)}</span></div><h2>${esc(rank?.name || '鹌鹑蛋')}</h2><p>${esc(rank?.domain || '')}</p>`;
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

function availableLevels() {
  const rank = normalizeRanks().find(item => item.status === 'current');
  const candidates = courseLevels().filter(level => !level.archived && (!rank || level.rankId === rank.id));
  return candidates.length ? candidates : currentLevel() ? [currentLevel()] : [];
}

function weekGoalValue(goal) {
  if (!goal) return '';
  return goal.kind === 'project-checkpoint' ? `project-checkpoint:${goal.projectId}:${goal.id}` : `level:${goal.id}`;
}

function weekGoalOptions() {
  const rank = normalizeRanks().find(item => item.status === 'current');
  const levels = courseLevels().filter(level => !level.archived && (!rank || level.rankId === rank.id)).map(level => ({ value: `level:${level.id}`, label: `${level.kind === 'rank-boss' ? 'Boss' : '关卡'} · ${level.title}` }));
  const projects = (course().projects || []).filter(project => !rank || project.rankId === rank.id).flatMap(project => [
    ...(project.chapters || []).map(chapter => ({ value: `project-checkpoint:${project.id}:${chapter.id}`, label: `${project.title} · ${chapter.title}` })),
    ...(project.boss ? [{ value: `project-checkpoint:${project.id}:${project.boss.id}`, label: `${project.title} · Boss` }] : [])
  ]);
  return [...levels, ...projects];
}

function parseWeekGoal(value) {
  const [kind, first, second] = value.split(':');
  return kind === 'project-checkpoint' ? { kind, projectId: first, id: second } : { kind: 'level', id: first };
}

function renderWeek() {
  const week = activeWeek();
  const levels = availableLevels();
  const goals = weekGoalOptions();
  const mainGoalValue = weekGoalValue(week?.mainGoal) || (week?.mainGoalId ? `level:${week.mainGoalId}` : '');
  $('#main-goal').innerHTML = goals.length
    ? goals.map(goal => `<option value="${esc(goal.value)}"${goal.value === mainGoalValue ? ' selected' : ''}>${esc(goal.label)}</option>`).join('')
    : '<option value="">暂无可选关卡</option>';
  $('#short-level').innerHTML = '<option value="">由系统建议</option>' + levels.filter(level => level.kind !== 'rank-boss' && level.activityType !== 'rank-project').map(level => `<option value="${esc(level.id)}"${level.id === week?.shortLevelId ? ' selected' : ''}>${esc(level.title)} · ${level.estimatedMinutes || 20} 分钟</option>`).join('');
  const mode = week?.mode || 'active';
  const modeInput = $(`input[name="mode"][value="${CSS.escape(mode)}"]`);
  if (modeInput) modeInput.checked = true;
  $('#play-days').value = String(Math.max(1, Math.min(7, Number(week?.playDays || state.home?.weekCard?.preferences?.normalPlayCount || 3))));
  $('#play-days-output').textContent = `${$('#play-days').value} 次`;
  $('#week-note').value = week?.note || '';
  updateWeekMode();
}

function updateWeekMode() {
  const rest = $('input[name="mode"]:checked')?.value === 'rest';
  $('#week-card-form').dataset.rest = String(rest);
  $$('#week-active-fields :is(input,select)').forEach(control => { control.disabled = rest; });
}

async function saveWeek(event) {
  event.preventDefault();
  if (state.weekSaving) return;
  const form = event.currentTarget;
  const mode = $('input[name="mode"]:checked')?.value || 'active';
  const mainGoalId = $('#main-goal').value;
  const source = state.home?.weekCard || {};
  const body = {
    schemaVersion: 2,
    courseId: course().courseId || course().id || 'eggy-programming-park',
    learnerId: learner().id || source.learnerId || 'learner-1',
    weekStart: activeWeek()?.weekStart || mondayFor(),
    mode,
    playDays: mode === 'rest' ? 0 : Number($('#play-days').value),
    mainGoal: mode === 'rest' || !mainGoalId ? null : parseWeekGoal(mainGoalId),
    shortLevelId: mode === 'rest' ? '' : $('#short-level').value,
    note: $('#week-note').value.trim(),
    revision: Number(activeWeek()?.revision ?? source.revision ?? 0)
  };
  state.weekSaving = true;
  $('#save-week-card').disabled = true;
  $('#week-form-message').classList.remove('error-message');
  $('#week-form-message').textContent = '正在保存…';
  try {
    const response = await requestJSON('/api/play/week-card', { method: 'PUT', body: JSON.stringify(body) });
    state.home.weekCard = response.data.weekCard || response.data;
    $('#week-form-message').classList.remove('error-message');
    $('#week-form-message').textContent = mode === 'rest' ? '已保存休息周，进度和奖励保持原样。' : '本周游玩卡已保存。';
    playTone('success');
    renderLobby();
  } catch (error) {
    $('#week-form-message').textContent = `${error.message}已填内容仍保留在本页。`;
    $('#week-form-message').classList.add('error-message');
  } finally {
    state.weekSaving = false;
    $('#save-week-card').disabled = false;
  }
}

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
$('#week-card-form').addEventListener('change', event => { if (event.target.name === 'mode') updateWeekMode(); });
$('#play-days').addEventListener('input', event => { $('#play-days-output').textContent = `${event.target.value} 次`; });
$('#week-card-form').addEventListener('submit', saveWeek);

loadHome();
