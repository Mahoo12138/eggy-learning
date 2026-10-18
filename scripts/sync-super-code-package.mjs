// Rebuild the cumulative networking/SQLite source package after running its generator.
// --with-draft publishes the authored curriculum too; --check validates without writing.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sanitizeCourse, sanitizeProject } from '../shared/park-domain.mjs';
import { sanitizeProjectCodePackage } from '../lib/project-code-delivery.mjs';
import { Store } from '../lib/store.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const projectId = 'super-arcade-data-center-project';
const args = process.argv.slice(2);
if (args.some(arg => !['--with-draft', '--check'].includes(arg))) throw new Error('仅支持 --with-draft 和 --check');
const readJSON = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const originalText = await readFile(join(root, 'data/course.json'), 'utf8');
const course = JSON.parse(originalText);
const projectIndex = course.projects.findIndex(item => item.id === projectId);
if (projectIndex < 0) throw new Error('课程索引缺少超级凤凰蛋作品');
const oldProject = structuredClone(course.projects[projectIndex]);
const project = args.includes('--with-draft')
  ? await readJSON('courseware/super-curriculum-draft.json')
  : structuredClone(oldProject);
if (project.id !== projectId || project.file !== oldProject.file || project.rankId !== oldProject.rankId) throw new Error('课件不能改变作品、段位或镜像文件身份');
const manifest = await readJSON('courseware/super-arcade-data-center/manifest.json');
if (manifest.chapters.map(chapter => chapter.id).join(',') !== project.chapters.map(chapter => chapter.id).join(',')) throw new Error('课程与源码章节顺序不一致');
const states = [{ id: 'super-empty', files: {} }];
const steps = [];
let previous = states[0];
const sorted = tree => JSON.stringify(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)));
for (const chapter of project.chapters) {
  const sourceChapter = manifest.chapters.find(item => item.id === chapter.id);
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
const codePackage = {
  schemaVersion: 1, projectId, states, steps,
  finalSource: {
    stateId: previous.id,
    buildCommands: manifest.finalSource?.buildCommands || ['make'],
    runCommands: manifest.finalSource?.runCommands || ['make test', 'make run'],
    expected: manifest.finalSource?.expected || ['网络故障、事务、重复请求与重启恢复检查通过；失败时返回非零退出码。', 'C 终端经 C 网关访问 C++ 服务，积分写入 SQLite 后可以查询。']
  }
};
const sourceText = `${JSON.stringify(codePackage, null, 2)}\n`;
project.codeDelivery = {
  schemaVersion: 1, packageFile: `project-code/${projectId}.json`,
  packageSha256: createHash('sha256').update(sourceText).digest('hex'),
  baselineStateId: states[0].id, finalStateId: previous.id
};
sanitizeProject(project);
sanitizeProjectCodePackage(codePackage, project);
course.projects[projectIndex] = project;
const rank = course.ranks.find(item => item.id === project.rankId);
const rankChanged = rank.technologyTheme !== project.technologyTheme;
rank.technologyTheme = project.technologyTheme;
if (JSON.stringify(oldProject) !== JSON.stringify(project) || rankChanged) course.publishedRevision++;
const details = await Promise.all([...course.levels, ...course.projects].map(item => item.id === projectId ? project : readJSON(`data/${item.file}`)));
sanitizeCourse(course, details);
if (args.includes('--check')) {
  console.log(`校验通过：${project.chapters.length} 节、${steps.length} 个完整代码增量，代码包 ${Buffer.byteLength(sourceText)} 字节；未写入。`);
} else {
  // Refuse to replace another editor's newer curriculum with a stale snapshot.
  if (await readFile(join(root, 'data/course.json'), 'utf8') !== originalText) throw new Error('课程在校验期间发生变化，请重新同步');
  await new Store(root).writeDataBatch([
    { relative: `data/${project.codeDelivery.packageFile}`, value: codePackage },
    { relative: `data/${project.file}`, value: project },
    { relative: 'data/course.json', value: course }
  ]);
  console.log(`已同步 ${project.chapters.length} 节、${steps.length} 个完整代码增量，课程版本 ${course.publishedRevision}。`);
}
