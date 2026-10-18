function clone(value) { return structuredClone(value); }

// Prose-only workshop edits can reuse published source; code references must
// still match that exact package, so a stale draft never previews other code.
export function matchingCodePackage(project, payload) {
  const codePackage = payload?.codePackage;
  const delivery = project?.codeDelivery;
  const mismatch = () => { throw new Error('课程草稿与已发布代码包不一致，请同步代码包和课程引用后再预览。'); };
  if (!delivery || payload?.packageSha256 !== delivery.packageSha256 || codePackage?.projectId !== project.id) mismatch();
  const states = new Map((codePackage.states || []).map(item => [item.id, item]));
  const steps = new Map((codePackage.steps || []).map(item => [item.id, item]));
  const authored = project.chapters.flatMap(chapter => chapter.guidedSteps || []);
  if (!states.has(delivery.baselineStateId) || codePackage.finalSource?.stateId !== delivery.finalStateId || !states.has(delivery.finalStateId) || steps.size !== authored.length) mismatch();
  let previous = delivery.baselineStateId;
  for (const chapter of project.chapters) {
    for (const step of chapter.guidedSteps || []) {
      const source = steps.get(step.codeStepId);
      if (!source || source.chapterId !== chapter.id || source.guidedStepId !== step.id || source.fromStateId !== previous || !states.has(source.toStateId)) mismatch();
      if (source.copyFiles.length !== step.targetFiles.length || step.targetFiles.some(path => !source.copyFiles.includes(path) || typeof states.get(source.toStateId).files[path] !== 'string')) mismatch();
      previous = source.toStateId;
    }
    if (chapter.snapshotStateId !== previous) mismatch();
  }
  if (previous !== delivery.finalStateId) mismatch();
  return clone(codePackage);
}

export function codeLanguage(path = '') {
  if (path.endsWith('CMakeLists.txt')) return 'cmake';
  const extension = path.toLowerCase().split('.').pop();
  return ({ c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', sql: 'sql', sh: 'bash', cmake: 'cmake', json: 'json', md: 'markdown', txt: 'plaintext', ld: 'plaintext' })[extension] || 'plaintext';
}

export function codeState(codePackage, stateId) {
  return codePackage?.states?.find(state => state.id === stateId) || null;
}

export function guidedCodeModel(codePackage, guidedStep) {
  if (!codePackage || !guidedStep?.codeStepId) return null;
  const delivery = codePackage.steps?.find(step => step.id === guidedStep.codeStepId);
  if (!delivery) return null;
  const state = codeState(codePackage, delivery.toStateId);
  if (!state) return null;
  return {
    ...clone(delivery),
    files: delivery.copyFiles.map(path => ({ path, language: codeLanguage(path), content: state.files[path] ?? '' }))
  };
}

export function snapshotCodeModel(codePackage, stateId) {
  const state = codeState(codePackage, stateId);
  if (!state) return null;
  return {
    id: state.id,
    files: Object.entries(state.files).sort(([left], [right]) => left.localeCompare(right)).map(([path, content]) => ({ path, language: codeLanguage(path), content }))
  };
}

export function starterProjectModel(codePackage, baselineStateId = codePackage?.steps?.[0]?.fromStateId) {
  const snapshot = snapshotCodeModel(codePackage, baselineStateId);
  return snapshot?.files.length ? snapshot : null;
}

export function codeDeliveryMode(codePackage, baselineStateId) {
  const starter = codeState(codePackage, baselineStateId ?? codePackage?.steps?.[0]?.fromStateId);
  const paths = Object.keys(starter?.files || {});
  if (!paths.length) return 'incremental';
  const sameFiles = state => {
    const statePaths = Object.keys(state?.files || {});
    return statePaths.length === paths.length
      && paths.every(path => state.files[path] === starter.files[path]);
  };
  return codePackage.states?.every(sameFiles) ? 'scaffold' : 'incremental';
}

export function finalSourceModel(codePackage) {
  if (!codePackage?.finalSource) return null;
  const snapshot = snapshotCodeModel(codePackage, codePackage.finalSource.stateId);
  return snapshot ? { ...clone(codePackage.finalSource), files: snapshot.files } : null;
}

export function chapterCodeReady(codePackage, chapter, status = 'ready') {
  const guidedSteps = chapter?.guidedSteps || [];
  if (!guidedSteps.some(step => step.codeStepId)) return true;
  return status === 'ready' && guidedSteps.every(step => !step.codeStepId || Boolean(guidedCodeModel(codePackage, step)));
}
