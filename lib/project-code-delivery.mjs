const ID = /^[a-z0-9][a-z0-9_-]{0,159}$/;
const MAX_FILE_BYTES = 500_000;
export const PROJECT_CODE_MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const GAP_MARKER = /^TODO\([A-Za-z0-9][A-Za-z0-9_-]{0,79}\)$/;

function invalid(message) {
  throw Object.assign(new Error(message), { status: 500, code: 'invalid_code_package' });
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${label}须为普通对象`);
  return value;
}

function exactFields(value, expected, label) {
  plainObject(value, label);
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) invalid(`${label}字段缺失或包含未知字段`);
}

function nonEmptyText(value, label, maximum = 50_000) {
  if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > maximum) invalid(`${label}须为非空文本`);
  return value;
}

function stableId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) invalid(`${label}须为小写稳定编号`);
  return value;
}

function list(value, label, { minimum = 0, maximum = 10_000 } = {}) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(`${label}须包含 ${minimum}–${maximum} 项`);
  return value;
}

function unique(items, selector, label) {
  const seen = new Set();
  for (const item of items) {
    const value = selector(item);
    if (seen.has(value)) invalid(`${label}重复：${value}`);
    seen.add(value);
  }
}

function sourcePath(value, label = '源码路径') {
  nonEmptyText(value, label, 300);
  const parts = value.split('/');
  if (value.startsWith('/') || value.includes('\\') || value.includes('\0') || parts.some(part => !part || part === '.' || part === '..')) invalid(`${label}须为安全的相对路径`);
  return value;
}

function portablePathKey(value) {
  return value.split('/').map(part => part.normalize('NFKC').normalize('NFC').toLowerCase()).join('/');
}

function validatePortableFileTree(files, label) {
  const pathsByPortableKey = new Map();
  for (const path of Object.keys(files)) {
    const key = portablePathKey(path);
    const previous = pathsByPortableKey.get(key);
    if (previous !== undefined) {
      invalid(`${label}的路径在忽略大小写或 Unicode 归一化后冲突：${previous}、${path}`);
    }
    pathsByPortableKey.set(key, path);
  }
  for (const [key, path] of pathsByPortableKey) {
    const parts = key.split('/');
    for (let length = 1; length < parts.length; length++) {
      const parent = pathsByPortableKey.get(parts.slice(0, length).join('/'));
      if (parent !== undefined) invalid(`${label}同时把 ${parent} 作为文件、又把它作为 ${path} 的目录`);
    }
  }
}

function stringList(value, label, minimum = 0) {
  return list(value, label, { minimum, maximum: 200 }).map(item => nonEmptyText(item, label));
}

function sameValues(left, right) {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function sameFileTree(left, right) {
  const leftPaths = Object.keys(left);
  const rightPaths = Object.keys(right);
  return leftPaths.length === rightPaths.length && leftPaths.every(path => Object.hasOwn(right, path) && left[path] === right[path]);
}

function clone(value) { return structuredClone(value); }

function countOccurrences(content, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = content.indexOf(needle, offset)) >= 0) {
    count++;
    offset += needle.length;
  }
  return count;
}

function commentOnlyFragment(path, fragment) {
  let meaningful = fragment.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  const slashComments = /\.(?:c|h|cc|cpp|cxx|hpp|ino|java|js|mjs|cjs|ts|tsx|cs|go|rs|swift|kt)$/i.test(path);
  const hashComments = /(?:^|\/)(?:CMakeLists\.txt|Makefile)$/i.test(path)
    || /\.(?:cmake|mk|sh|bash|zsh|py|rb|pl|ya?ml|toml|ini|conf)$/i.test(path);
  const dashComments = /\.(?:sql|lua|hs)$/i.test(path);
  meaningful = meaningful.split('\n').filter(line => {
    const value = line.trimStart();
    if (slashComments && value.startsWith('//')) return false;
    if (hashComments && value.startsWith('#')) return false;
    if (dashComments && value.startsWith('--')) return false;
    return Boolean(value.trim());
  }).join('\n');
  return !meaningful.trim();
}

function sourceFile(path) {
  const name = path.split('/').at(-1);
  return /^(?:CMakeLists\.txt|Makefile|Dockerfile)$/i.test(name)
    || /\.(?:c|h|cc|cpp|cxx|hpp|ino|s|asm|java|js|mjs|cjs|ts|tsx|cs|go|rs|swift|kt|kts|py|rb|pl|php|sh|bash|zsh|fish|ps1|bat|cmd|sql|lua|hs|cmake|mk|html|css|scss|sass|less|vue|svelte|xml|json|ya?ml|toml|ini|conf)$/i.test(path);
}

function markerScannerLine(path, line) {
  const validationPath = /(?:^|\/)(?:tests?|scripts?|tools?)(?:\/|$)/i.test(path)
    || /(?:verify|validat|lint|check)/i.test(path.split('/').at(-1));
  if (!validationPath) return false;
  return /\b(?:grep|egrep|fgrep|rg)\b/.test(line)
    || /\b(?:RegExp|doesNotMatch|assert\.(?:match|doesNotMatch))\b/.test(line)
    || (/\b(?:pattern|regex|markers?|tokens?|omissions?)\w*\s*(?:=|:)/i.test(line)
      && /(?:TODO|FIXME|TBD|NOT_IMPLEMENTED|implementation\s+omitted|省略实现|#\s*error)/i.test(line));
}

function omissionTokens(path, content) {
  if (!sourceFile(path)) return [];
  const tokens = new Set();
  const patterns = [
    /\bTODO(?:\([^\n)]*\))?(?![\w(])/g,
    /\b(?:FIXME|TBD|NOT_IMPLEMENTED|YOUR_CODE_HERE|IMPLEMENT_ME)\b/g,
    /\bimplementation\s+omitted\b/gi,
    /省略实现/g,
    /<待补全>/g,
    /^\s*\.\.\.\s*$/g,
    /\/\*\s*(?:省略|待补全)[^*]*\*\//g
  ];
  for (const line of content.split(/\r?\n/)) {
    if (markerScannerLine(path, line)) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of line.matchAll(pattern)) tokens.add(match[0]);
    }
    if (/\.(?:c|h|cc|cpp|cxx|hpp|ino)$/i.test(path) && /^\s*#\s*error\b/.test(line)) tokens.add('#error');
  }
  return [...tokens];
}

/**
 * Validate the lazy-loaded source snapshot package for one guided project.
 * Every `state` is a complete project tree. A code step names the files the
 * learner copies from its `toStateId`, then makes one or more small edits.
 */
export function sanitizeProjectCodePackage(raw, project) {
  if (!project?.codeDelivery || project.guidancePolicy?.codeDeliveryContractVersion !== 1) invalid('作品没有启用代码交付合同');
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > PROJECT_CODE_MAX_PACKAGE_BYTES) invalid('代码包超过 16 MB 上限');
  exactFields(raw, ['schemaVersion', 'projectId', 'states', 'steps', 'finalSource'], '作品代码包');
  if (raw.schemaVersion !== 1) invalid('代码包版本无效');
  if (raw.projectId !== project.id) invalid('代码包作品编号与课程不一致');

  const result = clone(raw);
  const states = list(result.states, '代码快照', { minimum: 2, maximum: 500 });
  unique(states, state => {
    exactFields(state, ['id', 'files'], '代码快照');
    const stateId = stableId(state.id, '代码快照编号');
    plainObject(state.files, `代码快照 ${stateId} 的文件`);
    if (Object.keys(state.files).length > 300) invalid(`代码快照 ${stateId} 的文件过多`);
    for (const [path, content] of Object.entries(state.files)) {
      sourcePath(path);
      if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) invalid(`代码快照 ${stateId} 的 ${path} 不是文本或超过 500 KB`);
    }
    validatePortableFileTree(state.files, `代码快照 ${stateId}`);
    return stateId;
  }, '代码快照编号');
  const stateById = new Map(states.map(state => [state.id, state]));
  for (const stateId of [project.codeDelivery.baselineStateId, project.codeDelivery.finalStateId]) {
    if (!stateById.has(stateId)) invalid(`课程引用了不存在的代码快照 ${stateId}`);
  }
  const baseline = stateById.get(project.codeDelivery.baselineStateId);
  const completeScaffoldMode = Object.keys(baseline.files).length > 0 && states.every(state => sameFileTree(state.files, baseline.files));

  const authoredSteps = project.chapters.flatMap(chapter => chapter.guidedSteps.map(step => ({ chapter, step })));
  const authoredByCodeStepId = new Map(authoredSteps.map(item => [item.step.codeStepId, item]));
  const steps = list(result.steps, '代码交付步骤', { minimum: authoredSteps.length, maximum: authoredSteps.length });
  unique(steps, step => {
    exactFields(step, ['id', 'chapterId', 'guidedStepId', 'fromStateId', 'toStateId', 'copyFiles', 'learnerChanges', 'intentionalGaps', 'verification'], '代码交付步骤');
    const stepId = stableId(step.id, '代码交付步骤编号');
    stableId(step.chapterId, '代码交付章节编号');
    stableId(step.guidedStepId, '课程引导步骤编号');
    stableId(step.fromStateId, '代码交付起始快照编号');
    stableId(step.toStateId, '代码交付结果快照编号');
    if (!stateById.has(step.fromStateId) || !stateById.has(step.toStateId)) invalid(`代码交付步骤 ${stepId} 引用了不存在的快照`);
    if (step.fromStateId === step.toStateId) invalid(`代码交付步骤 ${stepId} 的前后快照不能相同`);
    step.copyFiles = list(step.copyFiles, `代码交付步骤 ${stepId} 的完整复制文件`, { minimum: 1, maximum: 100 }).map(path => sourcePath(path));
    unique(step.copyFiles.map(path => ({ path })), item => item.path, `代码交付步骤 ${stepId} 的完整复制文件`);
    const authored = authoredByCodeStepId.get(stepId);
    if (!authored || !sameValues(step.copyFiles, authored.step.targetFiles)) invalid(`代码交付步骤 ${stepId} 必须为本步每个目标文件提供完整内容`);
    const targetFiles = stateById.get(step.toStateId).files;
    for (const path of step.copyFiles) if (!Object.hasOwn(targetFiles, path)) invalid(`代码交付步骤 ${stepId} 的结果快照缺少完整文件 ${path}`);
    const sourceFiles = stateById.get(step.fromStateId).files;
    const deletedPaths = Object.keys(sourceFiles).filter(path => !Object.hasOwn(targetFiles, path));
    if (deletedPaths.length) invalid(`代码交付步骤 ${stepId} 不能隐式删除文件：${deletedPaths.join('、')}`);
    const changedPaths = Object.keys(targetFiles).filter(path => !Object.hasOwn(sourceFiles, path) || sourceFiles[path] !== targetFiles[path]);
    const hiddenChanges = changedPaths.filter(path => !step.copyFiles.includes(path));
    if (hiddenChanges.length) invalid(`代码交付步骤 ${stepId} 修改了未列入完整复制文件的路径：${hiddenChanges.join('、')}`);
    if (!completeScaffoldMode && !changedPaths.length) invalid(`代码交付步骤 ${stepId} 必须实际改变代码快照`);

    step.learnerChanges = list(step.learnerChanges, `代码交付步骤 ${stepId} 的学习者小改动`, { minimum: 1, maximum: 20 });
    unique(step.learnerChanges, change => {
      exactFields(change, ['id', 'file', 'anchor', 'instruction', 'expectedFragment'], '学习者小改动');
      const changeId = stableId(change.id, '学习者小改动编号');
      sourcePath(change.file, '学习者小改动文件');
      nonEmptyText(change.anchor, '学习者小改动定位文本');
      nonEmptyText(change.instruction, '学习者小改动说明');
      nonEmptyText(change.expectedFragment, '学习者小改动预期片段');
      if (!step.copyFiles.includes(change.file)) invalid(`学习者小改动 ${changeId} 必须发生在本步完整复制文件中`);
      if (!targetFiles[change.file].includes(change.anchor)) invalid(`学习者小改动 ${changeId} 的定位文本不在 ${change.file} 中`);
      if (commentOnlyFragment(change.file, change.expectedFragment)) invalid(`学习者小改动 ${changeId} 的预期片段不能只有注释`);
      if (targetFiles[change.file].includes(change.expectedFragment)) invalid(`学习者小改动 ${changeId} 的预期片段已经存在于交付文件中，应留给学习者完成`);
      return changeId;
    }, `代码交付步骤 ${stepId} 的学习者小改动编号`);

    step.intentionalGaps = list(step.intentionalGaps, `代码交付步骤 ${stepId} 的刻意缺口`, { maximum: 30 });
    unique(step.intentionalGaps, gap => {
      exactFields(gap, ['id', 'file', 'marker', 'reason', 'resolvedInStepId'], '刻意缺口');
      const gapId = stableId(gap.id, '刻意缺口编号');
      sourcePath(gap.file, '刻意缺口文件');
      nonEmptyText(gap.marker, '刻意缺口标记', 300);
      if (!GAP_MARKER.test(gap.marker)) invalid(`刻意缺口 ${gapId} 的标记必须是精确的 TODO(ID)`);
      nonEmptyText(gap.reason, '刻意缺口原因');
      stableId(gap.resolvedInStepId, '刻意缺口补全步骤编号');
      if (!Object.hasOwn(targetFiles, gap.file) || !targetFiles[gap.file].includes(gap.marker)) invalid(`刻意缺口 ${gapId} 的标记未出现在结果快照 ${gap.file} 中`);
      return gapId;
    }, `代码交付步骤 ${stepId} 的刻意缺口编号`);

    exactFields(step.verification, ['commands', 'expected'], '代码步骤验证');
    step.verification.commands = stringList(step.verification.commands, '代码步骤验证命令', 1);
    step.verification.expected = stringList(step.verification.expected, '代码步骤预期结果', 1);
    return stepId;
  }, '代码交付步骤编号');

  const stepById = new Map(steps.map(step => [step.id, step]));
  const allGaps = steps.flatMap(step => step.intentionalGaps);
  unique(allGaps, gap => gap.marker, '刻意缺口标记');
  const authoredIndexByStepId = new Map(authoredSteps.map((item, index) => [item.step.codeStepId, index]));
  const stateAtStep = [];
  let previousStateId = project.codeDelivery.baselineStateId;
  for (const [index, authored] of authoredSteps.entries()) {
    const delivered = stepById.get(authored.step.codeStepId);
    if (!delivered) invalid(`课程步骤 ${authored.step.codeStepId} 在代码包中不存在`);
    if (delivered.chapterId !== authored.chapter.id || delivered.guidedStepId !== authored.step.id) invalid(`代码交付步骤 ${delivered.id} 与课程章节或步骤不匹配`);
    if (delivered.fromStateId !== previousStateId) invalid(`代码交付步骤 ${delivered.id} 未从上一完整快照继续`);
    previousStateId = delivered.toStateId;
    stateAtStep.push(stateById.get(delivered.toStateId));
    const lastInChapter = authored.chapter.guidedSteps.at(-1).codeStepId === delivered.id;
    if (lastInChapter && authored.chapter.snapshotStateId !== delivered.toStateId) invalid(`章节 ${authored.chapter.id} 的章末快照不是最后一步结果`);
    for (const gap of delivered.intentionalGaps) {
      const resolvedIndex = authoredIndexByStepId.get(gap.resolvedInStepId) ?? -1;
      if (resolvedIndex <= index) invalid(`刻意缺口 ${gap.id} 必须指向后续补全步骤`);
      const resolved = stepById.get(gap.resolvedInStepId);
      if (stateById.get(resolved.toStateId).files[gap.file]?.includes(gap.marker)) invalid(`刻意缺口 ${gap.id} 在声明的步骤 ${gap.resolvedInStepId} 后仍未补全`);
    }
  }
  if (previousStateId !== project.codeDelivery.finalStateId) invalid('最终代码快照不是最后一个引导步骤的结果');
  for (const stateId of project.chapters.map(chapter => chapter.snapshotStateId)) if (!stateById.has(stateId)) invalid(`章末快照 ${stateId} 在代码包中不存在`);

  const declaredGaps = authoredSteps.flatMap((authored, introducedAt) => {
    const delivery = stepById.get(authored.step.codeStepId);
    return delivery.intentionalGaps.map(gap => ({ ...gap, introducedAt, resolvedAt: authoredIndexByStepId.get(gap.resolvedInStepId) }));
  });
  for (const [path, content] of Object.entries(baseline.files)) {
    const tokens = omissionTokens(path, content);
    if (tokens.length) invalid(`起始快照 ${path} 包含未登记的省略标记：${tokens.join('、')}`);
  }
  for (const [stateIndex, state] of stateAtStep.entries()) {
    for (const [path, content] of Object.entries(state.files)) {
      const active = declaredGaps.filter(gap => gap.file === path && gap.introducedAt <= stateIndex && stateIndex < gap.resolvedAt);
      const untracked = omissionTokens(path, content).filter(token => !active.some(gap => gap.marker === token));
      if (untracked.length) invalid(`代码快照 ${state.id} 的 ${path} 包含未登记的省略标记：${untracked.join('、')}`);
    }
  }
  for (const gap of declaredGaps) {
    const timeline = [{ state: baseline, stateIndex: -1 }, ...stateAtStep.map((state, stateIndex) => ({ state, stateIndex }))];
    for (const { state, stateIndex } of timeline) {
      const occurrences = Object.entries(state.files).map(([path, content]) => ({ path, count: countOccurrences(content, gap.marker) })).filter(item => item.count);
      const total = occurrences.reduce((sum, item) => sum + item.count, 0);
      const active = gap.introducedAt <= stateIndex && stateIndex < gap.resolvedAt;
      const declaredFileCount = occurrences.find(item => item.path === gap.file)?.count || 0;
      if (active && (total !== 1 || declaredFileCount !== 1)) invalid(`刻意缺口 ${gap.id} 在快照 ${state.id} 的声明文件中必须恰好出现一次`);
      if (!active && total) invalid(`刻意缺口 ${gap.id} 在引入前或补全后仍出现在快照 ${state.id}`);
    }
  }

  exactFields(result.finalSource, ['stateId', 'buildCommands', 'runCommands', 'expected'], '最终工程运行说明');
  if (result.finalSource.stateId !== project.codeDelivery.finalStateId) invalid('最终工程运行说明未指向课程最终快照');
  result.finalSource.buildCommands = stringList(result.finalSource.buildCommands, '最终工程编译命令', 1);
  result.finalSource.runCommands = stringList(result.finalSource.runCommands, '最终工程运行命令', 1);
  result.finalSource.expected = stringList(result.finalSource.expected, '最终工程预期结果', 1);
  const finalFiles = stateById.get(result.finalSource.stateId).files;
  if (!Object.keys(finalFiles).length) invalid('最终工程快照不能为空');
  const unresolvedMarkers = steps.flatMap(step => step.intentionalGaps.map(gap => gap.marker)).filter(marker => Object.values(finalFiles).some(content => content.includes(marker)));
  if (unresolvedMarkers.length) invalid(`最终工程仍包含未补全标记：${unresolvedMarkers.join('、')}`);
  for (const [path, content] of Object.entries(finalFiles)) {
    if (omissionTokens(path, content).length) invalid(`最终工程 ${path} 仍包含省略代码或未完成标记`);
  }
  return result;
}

export function materializeProjectState(codePackage, stateId) {
  const state = codePackage?.states?.find(item => item.id === stateId);
  if (!state) invalid(`代码快照不存在：${stateId}`);
  return clone(state.files);
}

export function learnerCodeStep(codePackage, codeStepId) {
  const step = codePackage?.steps?.find(item => item.id === codeStepId);
  if (!step) invalid(`代码交付步骤不存在：${codeStepId}`);
  return { ...clone(step), files: Object.fromEntries(step.copyFiles.map(path => [path, materializeProjectState(codePackage, step.toStateId)[path]])) };
}
