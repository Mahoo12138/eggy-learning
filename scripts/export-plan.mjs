import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateCurriculum } from '../shared/study-domain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const course = validateCurriculum(JSON.parse(await readFile(join(root, 'data/curriculum.json'), 'utf8')));
const lines = [`# ${course.title}`, '', `导出时间：${new Date().toISOString()}。来源：data/curriculum.json。请在管理页维护课程，再重新导出；本文件不是另一份可编辑课程。`, '', course.schedule, '', '学习单元与日历周分开；以当前周容量安排，可以减量或暂停。验收依据是独立完成与证据，不是打卡次数。', ''];
for (const stage of course.stages.filter(s => !s.archived)) {
  lines.push(`## ${stage.title}`, '', stage.description, '');
  for (const unit of course.units.filter(u => !u.archived && u.stageId === stage.id)) {
    lines.push(`### ${unit.title}`, '', `单元编号：${unit.id}；验收版本：${unit.assessmentVersion}`, '', `目标：${unit.goal}`, '', `开始前：${unit.prerequisite}`, '', `产物：${unit.deliverable}`, '');
    for (const task of unit.tasks.filter(t => !t.archived)) {
      lines.push(`#### ${task.title}${task.id === unit.acceptanceTaskId ? '（独立验收）' : ''}`, '', `预计 ${task.estimatedMinutes} 分钟，可按可用时间拆分。`, '', ...task.steps.map((step, i) => `${i + 1}. ${step}`), '', `留下什么：${task.output}`, '', `如何检查：${task.verify}`, '');
      for (const q of task.questions.filter(q => !q.archived)) lines.push(`**${q.kind === 'reflection' ? '练习思考题' : '任务提问'} · ${q.id} / v${q.version}**`, '', q.prompt, '', ...q.hints.map(h => `- 提示：${h}`), '', ...q.referencePoints.map(p => `- 参考要点：${p}`), '');
    }
    lines.push('**验收标准**', '', ...unit.criteria.map(c => `- ${c.text}`), '');
  }
}
const destination = join(root, 'docs/当前学习训练计划.md');
await mkdir(join(root, 'docs'), { recursive: true });
await writeFile(destination, lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
console.log(destination);
