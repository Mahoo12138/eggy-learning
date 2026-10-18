// Rebuild the published source package from the authored C++ snapshots.
// Run the courseware generator first; this command preserves course prose.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { sanitizeProject } from '../shared/park-domain.mjs';
import { sanitizeProjectCodePackage } from '../lib/project-code-delivery.mjs';
import { Store } from '../lib/store.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const readJSON = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const course = await readJSON('data/course.json');
const project = course.projects.find(item => item.id === 'peak-delivery-center-project');
const manifest = await readJSON('courseware/peak-delivery-center/manifest.json');
const states = [{ id: 'peak-empty', files: {} }];
const steps = [];
let previous = states[0];
for (const chapter of project.chapters) {
  const sourceChapter = manifest.chapters.find(item => item.id === chapter.id);
  if (!sourceChapter || sourceChapter.steps.length !== chapter.guidedSteps.length) throw new Error(`章节代码数不一致：${chapter.id}`);
  chapter.filesTouched = [];
  for (const [index, authored] of chapter.guidedSteps.entries()) {
    const source = sourceChapter.steps[index];
    const next = { id: source.stateId, files: source.files };
    const copied = { ...previous.files };
    for (const path of source.copyFiles) {
      if (typeof next.files[path] !== 'string') throw new Error(`缺少完整文件：${path}`);
      copied[path] = next.files[path];
    }
    const sorted = tree => JSON.stringify(Object.entries(tree).sort(([a], [b]) => a.localeCompare(b)));
    if (sorted(copied) !== sorted(next.files)) throw new Error(`仅复制本步文件不能还原快照：${source.id}`);
    authored.id = source.id;
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
  schemaVersion: 1, projectId: project.id, states, steps,
  finalSource: {
    stateId: previous.id,
    buildCommands: ['make'],
    runCommands: ['make test', 'make run', 'make benchmark'],
    expected: ['全部功能与异常场景检查通过；失败时返回非零退出码。', '配送结果、库存和关店统计可核对；计算优化与并行版本的结果等于串行基准。', '基准输出实际测量结果；速度由硬件与负载决定，不要求固定加速倍数。']
  }
};
const sourceText = `${JSON.stringify(codePackage, null, 2)}\n`;
project.codeDelivery = {
  schemaVersion: 1, packageFile: `project-code/${project.id}.json`,
  packageSha256: createHash('sha256').update(sourceText).digest('hex'),
  baselineStateId: states[0].id, finalStateId: previous.id
};
sanitizeProject(project);
sanitizeProjectCodePackage(codePackage, project);
// Publish source, course index and detail mirror together after validation.
await new Store(root).writeDataBatch([
  { relative: `data/${project.codeDelivery.packageFile}`, value: codePackage },
  { relative: `data/${project.file}`, value: project },
  { relative: 'data/course.json', value: course }
]);
console.log(`已同步 ${project.chapters.length} 节、${steps.length} 个代码增量，${states.length - 1} 个完整快照。`);
