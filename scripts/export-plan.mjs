import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeCourse } from '../shared/park-domain.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = JSON.parse(await readFile(join(root, 'data/course.json'), 'utf8'));
const details = await Promise.all([...raw.levels, ...raw.projects].map(item => readFile(join(root, 'data', item.file), 'utf8').then(JSON.parse)));
const course = sanitizeCourse(raw, details);
const locations = new Map(course.locations.map(item => [item.id, item.title]));
const rewards = new Map(course.rewardCatalog.map(item => [item.sourceRankId, item.title]));

const lines = [
  `# ${course.title}`,
  '',
  `> ${course.subtitle}`,
  '',
  `导出时间：${new Date().toISOString()}。唯一可编辑来源是 \`data/course.json\` 与 \`data/levels/\`；本文用于审阅。`,
  '',
  '## 学习规则',
  '',
  '- 一次只显示一个步骤：观察示例、预测、运行观察、解释、引导操作、即时反馈、独立变式、延后重现。',
  '- 练习获得经验；首次独立完成变式获得星星；综合 Boss 负责晋段。',
  '- 查看完整解法不会扣除已有奖励，但当前变式不再授星，会改派等价新变式。',
  '- 允许休息周，不形成欠课；段位、星星、信物和作品永久保留。',
  '',
  '## 九阶乐园地图',
  ''
];

for (const rank of course.ranks) {
  const place = rank.locationIds.map(id => locations.get(id)).join('、');
  const levels = course.levels.filter(level => level.rankId === rank.id).sort((a, b) => a.sequence - b.sequence);
  const project = course.projects.find(item => item.id === rank.projectId);
  lines.push(`### ${rank.order}. ${rank.title}`, '', `- 技术：${rank.technologyTheme}`);
  if (levels.length) lines.push('- 训练形式：在线互动题与综合挑战');
  if (project) lines.push(`- 作品场景：${place}`);
  lines.push(`- 晋段奖励：${rewards.get(rank.id)}`, '');
  if (levels.length) {
    lines.push('| 顺序 | 关卡 | 形式 | 时长 |', '|---:|---|---|---:|');
    for (const level of levels) lines.push(`| ${level.sequence} | ${level.title} | ${level.kind === 'rank-boss' ? '综合 Boss' : '在线互动题'} | ${level.estimatedMinutes} 分钟 |`);
    lines.push('');
  }
  if (project) {
    lines.push(`**段位作品：${project.title}**`, '', project.story, '', '| 章节 | 目标 | 独立检查 |', '|---|---|---|');
    for (const chapter of project.chapters) lines.push(`| ${chapter.title} | ${chapter.goal} | ${chapter.checkpoint.task} |`);
    lines.push('', `**Boss：${project.boss.title}** — ${project.boss.story || project.boss.goal || '完成综合故障与独立变式。'}`, '');
  }
}

lines.push(
  '## 作品场景与可选素材',
  '',
  '以下建筑和道具只作为鹅蛋及后续段位的作品灵感，不出现在前三个段位普通题目的题面和步骤界面。',
  '',
  '| 建筑 | 可作为作品的技术情境 |',
  '|---|---|'
);
for (const location of course.locations) lines.push(`| ${location.title} | ${location.role} |`);
lines.push('', '| 可选素材 | 可作为作品的程序机制 |', '|---|---|');
for (const prop of course.props) lines.push(`| ${prop.title} | ${prop.semanticRole} |`);
lines.push('', `> ${course.legalNotice}`, '');

const destination = join(root, 'docs/当前学习训练计划.md');
await writeFile(destination, `${lines.join('\n')}\n`, 'utf8');
console.log(`已导出 ${destination}`);
