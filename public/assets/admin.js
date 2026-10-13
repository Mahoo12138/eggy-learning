const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const clone = value => structuredClone(value);

let state = null;
let courseDraft = null;
let courseETag = '';
let weekETag = '';
let selectedRankId = '';
let selectedContentKey = '';
let courseDirty = false;

class RequestError extends Error {
  constructor(message, status = 0, code = 'request_failed') { super(message); this.status = status; this.code = code; }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(path, {
      cache: 'no-store', ...options, signal: controller.signal,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
    });
    let data;
    try { data = await response.json(); } catch { throw new RequestError(`服务器返回了无法读取的内容（${response.status}）`, response.status); }
    if (!response.ok) throw new RequestError(data.error || `请求失败（${response.status}）`, response.status, data.code);
    return { data, etag: response.headers.get('ETag') || '' };
  } catch (error) {
    if (error.name === 'AbortError') throw new RequestError('连接超时，本次操作未确认完成。', 0, 'timeout');
    if (error instanceof RequestError) throw error;
    throw new RequestError('无法连接本地学习服务。', 0, 'network_error');
  } finally { clearTimeout(timer); }
}

function notice(message = '', error = false) {
  const node = $('#admin-notice');
  node.textContent = message; node.hidden = !message; node.classList.toggle('error', error);
}
function saveState(message) { $('#save-state').textContent = message; }
function setBusy(button, busy) { if (button) { button.disabled = busy; button.dataset.label ||= button.textContent; button.textContent = busy ? '处理中…' : button.dataset.label; } }
function fail(error) {
  const conflict = [409, 412, 428].includes(error.status) ? ' 当前页面保留了你的输入，请重新读取服务器版本后比较。' : '';
  notice(`${error.message}${conflict}`, true); saveState('本次操作未确认保存');
}
function markDirty() { courseDirty = true; saveState('课程有尚未保存的修改'); $('#save-course').textContent = '保存课程 ●'; }

function courseId(course) { return course?.courseId || course?.id || ''; }
function buildings(course) { return course?.locations || course?.buildings || []; }
function rankName(rank) { return rank?.title || rank?.name || rank?.id || '未命名段位'; }
function rankTechnology(rank) { return Array.isArray(rank?.technology) ? rank.technology.join('、') : rank?.technologyTheme || rank?.technology || rank?.theme || ''; }
function summaryData() { return state?.summary || state?.progressSummary || {}; }
function progressData() { return state?.progress || {}; }
function attempts() { return Array.isArray(progressData().attempts) ? progressData().attempts : []; }

function showTab(name) {
  $$('.admin-tabs button').forEach(button => button.setAttribute('aria-selected', String(button.dataset.tab === name)));
  $$('.admin-panel').forEach(panel => { panel.hidden = panel.id !== `panel-${name}`; });
  if (name === 'archive') renderArchive();
  if (name === 'workshop') renderWorkshop();
  if (name === 'operations') { renderWeekCard(); loadHistory(); }
}

function renderStats() {
  const progress = progressData(), summary = summaryData();
  const current = summary.currentRank || state?.course?.ranks?.find(rank => rank.id === (progress.currentRankId || progress.rankId)) || state?.course?.ranks?.[0];
  const stars = summary.starsTotal ?? progress.stars?.length ?? progress.starCount ?? 0;
  const tokens = summary.tokens?.length ?? progress.awardLedger?.filter(item => ['ability-token', 'project-trophy', 'final-trophy'].includes(item.kind)).length ?? 0;
  const completed = new Set(attempts().filter(attempt => attempt.result?.levelCompleted).map(attempt => attempt.payload?.levelId || attempt.payload?.projectId).filter(Boolean)).size;
  const xp = typeof summary.xp === 'object' ? summary.xp : typeof progress.xp === 'object' ? progress.xp : { total: summary.xp ?? progress.xp ?? 0, level: progress.level || 1 };
  const stats = [
    ['当前段位', rankName(current), 'Boss 晋段后永久保留'],
    ['成长经验', `${xp.total || 0} XP`, `Lv. ${xp.level || 1}`],
    ['独立星星', `${stars} 颗`, '首次独立变式获得'],
    ['已完成', `${completed} 关`, `${tokens} 件信物或作品`]
  ];
  $('#overview-stats').innerHTML = stats.map(([label, value, note]) => `<div class="stat"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');
}

function renderRanks() {
  const summary = summaryData();
  const summaryRanks = new Map((summary.ranks || []).map(rank => [rank.id, rank]));
  const currentId = summary.currentRank?.id || progressData().currentRankId || progressData().rankId;
  $('#overview-ranks').innerHTML = (state?.course?.ranks || []).map((rank, index) => {
    const info = summaryRanks.get(rank.id) || {};
    const rawStatus = info.status || (rank.id === currentId ? 'available' : index === 0 && !currentId ? 'available' : 'locked');
    const status = rawStatus === 'available' && rank.id === currentId ? 'current' : rawStatus;
    const label = status === 'completed' ? '已晋段' : status === 'current' ? '当前' : status === 'available' ? '可游玩' : '未解锁';
    const requiredStars = rank.promotion?.requiredStars;
    const stars = Number.isFinite(requiredStars) ? `${info.stars || 0}/${requiredStars} 星` : rank.projectId ? '段位作品' : '互动关卡';
    return `<li data-status="${esc(status)}"><span class="rank-index">${index + 1}</span><span class="rank-copy"><strong>${esc(rankName(rank))}</strong><small>${esc(rankTechnology(rank))} · ${esc(stars)}</small></span><span class="status-pill ${esc(status)}">${label}</span></li>`;
  }).join('');
}

function attemptView(attempt) {
  const payload = attempt.payload || attempt;
  const result = attempt.result || attempt.feedback || {};
  const passed = payload.passed === true || result.levelCompleted === true || result.checkpointCompleted === true || result.passed === true;
  return {
    id: attempt.id || payload.requestId || '',
    when: attempt.submittedAt || attempt.createdAt || payload.submittedAt || '',
    kind: attempt.kind || (payload.projectId ? 'project' : 'level'),
    title: payload.levelId || payload.projectId || attempt.levelTitle || '未知内容',
    step: payload.stepId || payload.checkpointId || attempt.stepTitle || '',
    answer: payload.answer || payload.code || attempt.answer || '',
    hint: Number(payload.hintLevel ?? attempt.hintLevel ?? 0),
    full: payload.viewedFullAnswer === true || attempt.viewedFullAnswer === true,
    independent: payload.independent === true || attempt.independent === true,
    passed,
    result
  };
}

function renderRecent() {
  const rows = attempts().slice(-6).reverse().map(attemptView);
  $('#recent-attempts').innerHTML = rows.length ? rows.map(row => `<div class="activity-item"><div class="activity-top"><strong>${esc(row.title)}${row.step ? ` · ${esc(row.step)}` : ''}</strong><span class="activity-result ${row.passed ? 'passed' : ''}">${row.passed ? '通过' : '继续尝试'}</span></div><p>${esc(row.when ? new Date(row.when).toLocaleString('zh-CN') : '时间未记录')} · 提示 ${row.hint} 层${row.independent ? ' · 独立完成' : ''}</p></div>`).join('') : '<p class="empty">还没有学习尝试。完成第一步后，这里会显示真实过程。</p>';
}

function renderOverview() { renderStats(); renderRanks(); renderRecent(); }

function renderArchive() {
  const filter = $('#attempt-filter').value;
  const query = $('#attempt-search').value.trim().toLowerCase();
  const rows = attempts().map(attemptView).reverse().filter(row => {
    if (filter === 'passed' && !row.passed) return false;
    if (filter === 'failed' && row.passed) return false;
    if (filter === 'hinted' && row.hint === 0 && !row.full) return false;
    return !query || `${row.title} ${row.step} ${row.answer}`.toLowerCase().includes(query);
  });
  $('#attempt-table').innerHTML = rows.length ? `<table class="attempt-table"><thead><tr><th>时间</th><th>关卡 / 步骤</th><th>过程</th><th>结果</th><th>作答与反馈</th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.when ? new Date(row.when).toLocaleString('zh-CN') : '—')}</td><td><strong>${esc(row.title)}</strong><br><span class="muted">${esc(row.step || row.kind)}</span></td><td>提示 ${row.hint} 层${row.full ? '<br>看过完整思路' : ''}${row.independent ? '<br>独立完成' : ''}</td><td><span class="activity-result ${row.passed ? 'passed' : ''}">${row.passed ? '通过' : '未通过'}</span></td><td><details><summary>展开证据</summary><div class="attempt-detail">作答：\n${esc(row.answer || '（未记录文本）')}\n\n反馈：\n${esc(JSON.stringify(row.result, null, 2))}</div></details></td></tr>`).join('')}</tbody></table>` : '<p class="empty">当前筛选下没有学习记录。</p>';

  const progress = progressData();
  const rewardDefinitions = state?.course?.rewardCatalog || [];
  const achievementDefinitions = state?.course?.achievements || [];
  const tokens = (progress.awardLedger || []).filter(item => ['ability-token', 'project-trophy', 'final-trophy'].includes(item.kind)).map(item => ({
    ...item,
    title: item.title || rewardDefinitions.find(definition => definition.sourceRankId === item.rankId && definition.kind === item.kind)?.title
  }));
  const achievements = (progress.achievementWall?.earned || []).map(item => ({
    ...item,
    kind: 'achievement',
    title: achievementDefinitions.find(definition => definition.id === item.achievementId)?.title || item.achievementId
  }));
  const artifacts = (progress.projectArtifacts || progress.artifacts || []).filter(item => item.bossCompletedAt || item.completedAt);
  const honors = [
    ...tokens.map(item => ({ icon: item.kind.includes('trophy') ? '◆' : '★', title: item.title || item.tokenId || item.name, note: item.earnedAt || item.unlockedAt || '已获得' })),
    ...achievements.map(item => ({ icon: '✦', title: item.title, note: item.earnedAt || '已获得' })),
    ...artifacts.map(item => ({ icon: '▣', title: item.title || item.projectTitle || item.projectId, note: item.completedAt || item.updatedAt || '作品战利品' }))
  ];
  $('#honor-count').textContent = `${honors.length} 件`;
  $('#honor-list').innerHTML = honors.length ? honors.map(item => `<div class="honor"><span aria-hidden="true">${item.icon}</span><strong>${esc(item.title)}</strong><small>${esc(item.note)}</small></div>`).join('') : '<p class="empty">完成前三段 Boss 会获得能力信物；鹅蛋开始，作品会成为战利品。</p>';
}

function contentsForRank(rank) {
  const course = courseDraft;
  const levels = (course.levels || []).filter(level => level.rankId === rank.id || rank.levelIds?.includes(level.id));
  const project = (course.projects || []).find(item => item.rankId === rank.id || item.id === rank.projectId);
  return [...levels.map(item => ({ kind: 'level', item })), ...(project ? [{ kind: 'project', item: project }] : [])];
}

function rankBuildingValue(rank) {
  if (Array.isArray(rank.locationIds)) return rank.locationIds.join(', ');
  return rank.buildingId || rank.locationId || '';
}

function renderRankEditor(rank) {
  const fields = [
    ['段位名称', 'name', rank.title ?? rank.name ?? ''],
    ['技术主题', 'technology', rankTechnology(rank)],
    ['场景编号', 'building', rankBuildingValue(rank)]
  ];
  $('#rank-editor').innerHTML = fields.map(([label, field, value]) => `<label>${esc(label)}<input data-rank-field="${field}" value="${esc(value)}"></label>`).join('');
}

function applyRankField(rank, field, value) {
  if (field === 'name') {
    if ('title' in rank) rank.title = value; else rank.name = value;
  } else if (field === 'technology') {
    if ('technologyTheme' in rank) rank.technologyTheme = value;
    else rank.technology = Array.isArray(rank.technology) ? value.split(/[、,，]/).map(item => item.trim()).filter(Boolean) : value;
  } else if (field === 'building') {
    if (Array.isArray(rank.locationIds)) rank.locationIds = value.split(/[,，]/).map(item => item.trim()).filter(Boolean);
    else if ('buildingId' in rank) rank.buildingId = value.trim();
    else rank.locationId = value.trim();
  }
}

function selectedContent() {
  const [kind, id] = selectedContentKey.split(':');
  const collection = kind === 'project' ? courseDraft?.projects : courseDraft?.levels;
  return { kind, item: collection?.find(item => item.id === id) };
}

function renderContentEditor() {
  const { kind, item } = selectedContent();
  $('#content-editor-title').textContent = item ? `${kind === 'project' ? '作品' : '关卡'} · ${item.title || item.name || item.id}` : '内容设置';
  $('#content-json').value = item ? JSON.stringify(item, null, 2) : '';
  $('#content-json').disabled = !item;
  $('#json-error').textContent = '';
}

function renderWorkshop() {
  if (!courseDraft) return;
  const ranks = courseDraft.ranks || [];
  if (!ranks.some(rank => rank.id === selectedRankId)) selectedRankId = ranks[0]?.id || '';
  $('#rank-select').innerHTML = ranks.map(rank => `<option value="${esc(rank.id)}" ${rank.id === selectedRankId ? 'selected' : ''}>${esc(`${rank.order || ranks.indexOf(rank) + 1}. ${rankName(rank)}`)}</option>`).join('');
  const rank = ranks.find(item => item.id === selectedRankId);
  if (!rank) return;
  renderRankEditor(rank);
  const content = contentsForRank(rank);
  if (!content.some(entry => `${entry.kind}:${entry.item.id}` === selectedContentKey)) selectedContentKey = content[0] ? `${content[0].kind}:${content[0].item.id}` : '';
  $('#level-select').innerHTML = content.length ? content.map(entry => `<option value="${entry.kind}:${esc(entry.item.id)}" ${`${entry.kind}:${entry.item.id}` === selectedContentKey ? 'selected' : ''}>${entry.kind === 'project' ? '作品' : entry.item.kind === 'rank-boss' ? 'Boss' : '关卡'} · ${esc(entry.item.title || entry.item.name || entry.item.id)}</option>`).join('') : '<option value="">此段位暂无内容</option>';
  const placeNames = buildings(courseDraft).filter(place => (rank.locationIds || [rank.buildingId]).includes(place.id)).map(place => place.title || place.name);
  $('#workshop-summary').innerHTML = `<strong>${esc(rankName(rank))}</strong><br>${esc(rankTechnology(rank) || '未填写技术主题')}<br>${esc(placeNames.join('、') || '未绑定场景')}<br>${content.length} 个关卡或作品条目`;
  renderContentEditor();
}

function commitContentJSON({ quiet = false } = {}) {
  const { kind, item } = selectedContent();
  if (!item) return true;
  try {
    const parsed = JSON.parse($('#content-json').value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.id !== item.id) throw new Error('内容必须是对象，并保留当前稳定编号。');
    const collection = kind === 'project' ? courseDraft.projects : courseDraft.levels;
    collection[collection.findIndex(entry => entry.id === item.id)] = parsed;
    $('#json-error').textContent = '';
    if (!quiet) markDirty();
    return true;
  } catch (error) {
    $('#json-error').textContent = `JSON 未采用：${error.message}`;
    return false;
  }
}

function goalOptions() {
  const course = state?.course || {};
  const levels = (course.levels || []).map(level => ({ value: `level:${level.id}`, label: `${level.kind === 'rank-boss' ? 'Boss' : '关卡'} · ${level.title || level.name || level.id}` }));
  const checkpoints = (course.projects || []).flatMap(project => (project.checkpoints || project.chapters || []).filter(item => item.kind !== 'boss').map(item => ({ value: `project-checkpoint:${project.id}:${item.id}`, label: `${project.title || project.id} · ${item.title || item.id}` })));
  return [...levels, ...checkpoints];
}

function goalToValue(goal) {
  if (!goal) return '';
  return goal.kind === 'level' ? `level:${goal.id}` : `project-checkpoint:${goal.projectId}:${goal.id}`;
}
function valueToGoal(value) {
  const [kind, first, second] = value.split(':');
  return kind === 'level' ? { kind, id: first } : { kind: 'project-checkpoint', projectId: first, id: second };
}

function renderWeekCard() {
  if (!state) return;
  const card = state.weekCard || {};
  $('#week-start-label').textContent = card.weekStart || '本周';
  const mode = card.mode || 'rest';
  $$('input[name=mode]').forEach(input => { input.checked = input.value === mode; });
  $('#admin-play-days').value = Math.max(1, card.playDays || 2);
  const options = goalOptions();
  $('#admin-main-goal').innerHTML = options.length ? options.map(option => `<option value="${esc(option.value)}" ${option.value === goalToValue(card.mainGoal) ? 'selected' : ''}>${esc(option.label)}</option>`).join('') : '<option value="">暂无可选目标</option>';
  $('#admin-short-level').innerHTML = '<option value="">不指定</option>' + (state.course?.levels || []).filter(level => level.kind !== 'rank-boss').map(level => `<option value="${esc(level.id)}" ${level.id === card.shortLevelId ? 'selected' : ''}>${esc(level.title || level.name || level.id)}</option>`).join('');
  $('#admin-week-note').value = card.note || '';
  updateWeekMode();
}

function updateWeekMode() {
  const rest = $('input[name=mode]:checked')?.value === 'rest';
  for (const node of [$('#admin-play-days'), $('#admin-main-goal'), $('#admin-short-level')]) node.disabled = rest;
}

async function loadState({ preserveDraft = false } = {}) {
  notice(); saveState('正在读取乐园数据…');
  const response = await request('/api/admin/state');
  state = response.data;
  if (!preserveDraft) { courseDraft = clone(state.course); courseETag = state.versions?.course || response.data.courseETag || ''; courseDirty = false; $('#save-course').textContent = '保存课程'; }
  weekETag = state.versions?.weekCard || state.weekCardETag || '';
  renderOverview(); renderArchive(); renderWorkshop(); renderWeekCard();
  saveState(`已读取 · ${new Date().toLocaleTimeString('zh-CN')}`);
}

async function saveCourse() {
  if (!commitContentJSON({ quiet: true })) return;
  const button = $('#save-course'); setBusy(button, true);
  try {
    const response = await request('/api/admin/course', { method: 'PUT', headers: courseETag ? { 'If-Match': courseETag } : {}, body: JSON.stringify(courseDraft) });
    courseDraft = clone(response.data.course || response.data);
    courseETag = response.etag || response.data.version || courseETag;
    courseDirty = false; button.dataset.label = '保存课程';
    await loadState(); notice('课程已通过校验并保存。');
  } catch (error) { fail(error); } finally { setBusy(button, false); }
}

async function saveWeekCard(event) {
  event.preventDefault();
  const button = event.submitter; setBusy(button, true);
  const mode = $('input[name=mode]:checked')?.value || 'rest';
  const current = state.weekCard;
  const payload = {
    ...current,
    mode,
    playDays: mode === 'rest' ? 0 : Number($('#admin-play-days').value),
    mainGoal: mode === 'rest' ? null : valueToGoal($('#admin-main-goal').value),
    shortLevelId: mode === 'rest' ? '' : $('#admin-short-level').value,
    note: $('#admin-week-note').value,
    revision: Number(current.revision || 0)
  };
  try {
    const response = await request('/api/play/week-card', { method: 'PUT', headers: weekETag ? { 'If-Match': weekETag } : {}, body: JSON.stringify(payload) });
    state.weekCard = response.data.weekCard || response.data; weekETag = response.etag || response.data.version || weekETag;
    renderWeekCard(); saveState('本周游玩卡已保存'); notice('本周节奏已更新，不会产生欠课。');
  } catch (error) { fail(error); } finally { setBusy(button, false); }
}

function download(name, value) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadHistory() {
  try {
    const { data } = await request('/api/admin/history?kind=all&limit=10');
    $('#history-status').textContent = data.message || '';
    $('#history-list').innerHTML = data.items?.length ? data.items.map(item => `<div class="activity-item"><div class="activity-top"><strong>${esc(item.subject)}</strong><code>${esc(item.shortHash)}</code></div><p>${esc(item.authorName)} · ${esc(new Date(item.committerDate).toLocaleString('zh-CN'))}</p></div>`).join('') : '<p class="empty">当前没有可显示的本地提交。</p>';
  } catch (error) { $('#history-status').textContent = error.message; $('#history-list').innerHTML = ''; }
}

function learningSummaryText() {
  const summary = summaryData();
  const current = summary.currentRank || {};
  const xp = typeof summary.xp === 'object' ? summary.xp.total : typeof progressData().xp === 'object' ? progressData().xp.total : summary.xp ?? progressData().xp ?? 0;
  const completed = new Set(attempts().filter(attempt => attempt.result?.levelCompleted).map(attempt => attempt.payload?.levelId || attempt.payload?.projectId).filter(Boolean)).size;
  const rows = [
    '蛋仔编程乐园学习摘要',
    `当前段位：${rankName(current)}`,
    `经验：${xp} XP`,
    `星星：${summary.starsTotal ?? progressData().stars?.length ?? 0}`,
    `已完成活动：${completed}`,
    `累计尝试：${attempts().length}`,
    '',
    '最近尝试：',
    ...attempts().slice(-5).reverse().map(item => { const row = attemptView(item); return `- ${row.title}/${row.step || row.kind}：${row.passed ? '通过' : '继续尝试'}，提示 ${row.hint} 层`; })
  ];
  return rows.join('\n');
}

$('.admin-tabs').addEventListener('click', event => { const button = event.target.closest('[data-tab]'); if (button) showTab(button.dataset.tab); });
document.addEventListener('click', event => {
  const tab = event.target.closest('[data-open-tab]'); if (tab) showTab(tab.dataset.openTab);
  if (event.target.closest('[data-refresh]')) loadState({ preserveDraft: courseDirty }).catch(fail);
});
$('#attempt-filter').addEventListener('change', renderArchive);
$('#attempt-search').addEventListener('input', renderArchive);
$('#rank-select').addEventListener('change', event => { if (!commitContentJSON({ quiet: true })) { event.target.value = selectedRankId; return; } selectedRankId = event.target.value; selectedContentKey = ''; renderWorkshop(); });
$('#level-select').addEventListener('change', event => { if (!commitContentJSON({ quiet: true })) { event.target.value = selectedContentKey; return; } selectedContentKey = event.target.value; renderContentEditor(); });
$('#rank-editor').addEventListener('input', event => { const input = event.target.closest('[data-rank-field]'); if (!input) return; const rank = courseDraft.ranks.find(item => item.id === selectedRankId); applyRankField(rank, input.dataset.rankField, input.value); markDirty(); });
$('#content-json').addEventListener('input', markDirty);
$('#save-course').addEventListener('click', saveCourse);
$('#reload-course').addEventListener('click', async () => { if (courseDirty && !confirm('重新读取会放弃本页尚未保存的课程修改。确定继续吗？')) return; try { await loadState(); notice('已读取服务器课程版本。'); } catch (error) { fail(error); } });
$$('input[name=mode]').forEach(input => input.addEventListener('change', updateWeekMode));
$('#week-card-form').addEventListener('submit', saveWeekCard);
$('#export-data').addEventListener('click', async event => { const button = event.currentTarget; setBusy(button, true); try { const { data } = await request('/api/admin/export'); download(`eggy-learning-park-${new Date().toISOString().slice(0, 10)}.json`, data); notice('导出文件已生成。'); } catch (error) { fail(error); } finally { setBusy(button, false); } });
$('#copy-summary').addEventListener('click', async () => { try { await navigator.clipboard.writeText(learningSummaryText()); notice('学习摘要已复制。'); } catch { notice('浏览器没有允许复制，请改用数据导出。', true); } });
$('#refresh-history').addEventListener('click', loadHistory);
addEventListener('beforeunload', event => { if (courseDirty) { event.preventDefault(); event.returnValue = ''; } });

loadState().catch(fail);
