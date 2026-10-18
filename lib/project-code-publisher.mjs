import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { sanitizeCourse, sanitizeProject, sanitizeProgress, sanitizeWeekCard } from '../shared/park-domain.mjs';
import { PROJECT_CODE_MAX_PACKAGE_BYTES, sanitizeProjectCodePackage } from './project-code-delivery.mjs';
import { Store, acquireLock, encode, fingerprint, safeId } from './store.mjs';

function detailPath(item) {
  if (!safeId(item.id) || item.file !== `levels/${item.id}.json`) {
    throw new Error(`活动 ${item.id} 的详情镜像路径无效`);
  }
  return `data/${item.file}`;
}

/**
 * Publish one course recipe without letting the recipe own publication order.
 * build receives an isolated project and returns { project, codePackage };
 * rankTechnologyTheme is an optional, explicit update used by the super recipe.
 * check performs the same validation without acquiring the server lock or writing.
 * A supplied Store must use this root; its existing fault hooks also test rollback.
 */
export async function publishProjectCode({ root, projectId, build, check = false, store = new Store(root) }) {
  if (!safeId(projectId) || typeof build !== 'function') throw new Error('源码发布缺少有效的作品编号或组装函数');
  if (!(store instanceof Store) || resolve(store.root) !== resolve(root)) throw new Error('源码发布 Store 必须使用同一个数据目录');
  const release = check ? async () => {} : await acquireLock(root);
  try {
    await store.assertPlainDataTree();
    // Capture the actual input bytes, including every detail mirror. The lock
    // excludes the server/other publishers; this also detects manual edits.
    const originals = new Map();
    async function readSnapshot(relative, optional = false) {
      let text;
      try { text = await readFile(join(root, relative), 'utf8'); }
      catch (error) {
        if (!optional || error.code !== 'ENOENT') throw error;
        text = null;
      }
      originals.set(relative, text);
      return text;
    }
    const course = JSON.parse(await readSnapshot('data/course.json'));
    sanitizeCourse(course);
    const projectIndex = course.projects.findIndex(item => item.id === projectId);
    if (projectIndex < 0) throw new Error(`课程索引缺少 ${projectId}`);
    const oldProject = course.projects[projectIndex];
    const activities = [...course.levels, ...course.projects];
    const details = await Promise.all(activities.map(async item => {
      const detail = JSON.parse(await readSnapshot(detailPath(item)));
      // sanitizeCourse checks content, but it accepts a collection regardless
      // of which path each document came from. Keep that identity here.
      if (detail.id !== item.id) throw new Error(`详情镜像身份不一致：${item.id}/${detail.id}`);
      return detail;
    }));
    sanitizeCourse(course, details);
    const progress = JSON.parse(await readSnapshot('data/progress.json'));
    const weekCard = JSON.parse(await readSnapshot('data/week-card.json'));
    const packageFile = `project-code/${projectId}.json`;
    const packagePath = `data/${packageFile}`;
    const oldPackageText = await readSnapshot(packagePath, true);
    const candidate = await build({ project: structuredClone(oldProject) });
    const project = structuredClone(candidate.project);
    const codePackage = structuredClone(candidate.codePackage);
    if (project.id !== projectId || project.rankId !== oldProject.rankId || project.file !== oldProject.file) {
      throw new Error('源码发布不能改变作品、段位或镜像文件身份');
    }
    if (project.version < oldProject.version) throw new Error('源码发布的作品版本不能回退');
    if (project.codeDelivery && project.codeDelivery.packageFile !== packageFile) throw new Error('源码发布不能改变代码包文件身份');
    const packageText = encode(codePackage);
    const packageBytes = Buffer.byteLength(packageText, 'utf8');
    // The server limits encoded bytes on disk, not compact JSON size.
    if (packageBytes > PROJECT_CODE_MAX_PACKAGE_BYTES) throw new Error('序列化后的代码包超过 16 MB 上限');
    project.codeDelivery = {
      schemaVersion: 1, packageFile,
      packageSha256: createHash('sha256').update(packageText).digest('hex'),
      baselineStateId: codePackage.states?.[0]?.id,
      finalStateId: codePackage.finalSource?.stateId
    };
    sanitizeProject(project);
    sanitizeProjectCodePackage(codePackage, project);
    course.projects[projectIndex] = project;
    const rank = course.ranks.find(item => item.id === project.rankId);
    const previousTheme = rank.technologyTheme;
    // Rank and project themes are separate editorial fields. Only a recipe
    // that explicitly authors the rank theme may update it (the super draft).
    if (Object.hasOwn(candidate, 'rankTechnologyTheme')) rank.technologyTheme = candidate.rankTechnologyTheme;
    const contentChanged = fingerprint(oldProject) !== fingerprint(project) || previousTheme !== rank.technologyTheme;
    if (contentChanged) course.publishedRevision++;
    const nextDetails = details.map(detail => detail.id === projectId ? project : detail);
    const hydrated = sanitizeCourse(course, nextDetails);
    // Source publication must leave the existing learner records readable.
    // Validate them as-is; never rewrite records to fit the new curriculum.
    sanitizeProgress(hydrated, progress);
    sanitizeWeekCard(hydrated, weekCard);
    const changed = contentChanged || oldPackageText !== packageText;

    // Even a dry run cannot claim validation of inputs that changed under it.
    for (const [relative, original] of originals) {
      let current;
      try { current = await readFile(join(root, relative), 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; current = null; }
      if (current !== original) throw new Error(`课程在校验期间发生变化：${relative}，请重新同步`);
    }
    if (!check && changed) {
      await store.writeDataBatch([
        { relative: packagePath, value: codePackage },
        { relative: detailPath(project), value: project },
        { relative: 'data/course.json', value: course }
      ]);
    }
    return {
      check, changed, written: !check && changed, publishedRevision: course.publishedRevision,
      chapters: project.chapters.length, steps: codePackage.steps.length,
      states: codePackage.states.length, packageBytes, packageSha256: project.codeDelivery.packageSha256
    };
  } finally {
    await release();
  }
}

/** Assemble the two incremental manifest courses, preserving authored identities. */
export function prepareSnapshotProject(sourceProject, manifest, { baselineStateId, finalSource }) {
  const project = structuredClone(sourceProject);
  if (!Array.isArray(manifest.chapters) || JSON.stringify(manifest.chapters.map(chapter => chapter.id)) !== JSON.stringify(project.chapters.map(chapter => chapter.id))) {
    throw new Error('课程与源码章节顺序不一致');
  }
  const states = [{ id: baselineStateId, files: {} }];
  const steps = [];
  let previous = states[0];
  const sorted = tree => JSON.stringify(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)));
  for (const [chapterIndex, chapter] of project.chapters.entries()) {
    const sourceChapter = manifest.chapters[chapterIndex];
    if (sourceChapter.steps.length !== chapter.guidedSteps.length) throw new Error(`章节代码数不一致：${chapter.id}`);
    chapter.filesTouched = [];
    for (const [index, authored] of chapter.guidedSteps.entries()) {
      const source = sourceChapter.steps[index];
      if (authored.id !== source.id) throw new Error(`课程与源码步骤身份不一致：${authored.id}/${source.id}`);
      const next = { id: source.stateId, files: source.files };
      const copied = { ...previous.files };
      for (const path of source.copyFiles) {
        if (typeof next.files[path] !== 'string') throw new Error(`缺少完整文件：${path}`);
        copied[path] = next.files[path];
      }
      if (sorted(copied) !== sorted(next.files)) throw new Error(`仅复制本步文件不能还原快照：${source.id}`);
      authored.codeStepId = `${source.id}-code`;
      authored.targetFiles = source.copyFiles;
      for (const path of source.copyFiles) if (!chapter.filesTouched.includes(path)) chapter.filesTouched.push(path);
      states.push(next);
      steps.push({
        id: authored.codeStepId, chapterId: chapter.id, guidedStepId: authored.id,
        fromStateId: previous.id, toStateId: next.id, copyFiles: source.copyFiles,
        learnerChanges: [{ id: `${source.id}-experiment`, ...source.learnerChange }],
        intentionalGaps: [], verification: { commands: source.commands, expected: source.expected }
      });
      previous = next;
    }
    chapter.snapshotStateId = previous.id;
  }
  return {
    project,
    codePackage: { schemaVersion: 1, projectId: project.id, states, steps, finalSource: { stateId: previous.id, ...finalSource } }
  };
}
