import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeCourse } from '../shared/park-domain.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const raw = JSON.parse(await readFile(join(root, 'data/course.json'), 'utf8'));
const details = await Promise.all([...raw.levels, ...raw.projects].map(item => readFile(join(root, 'data', item.file), 'utf8').then(JSON.parse)));
const course = sanitizeCourse(raw, details);
const locations = new Map(course.locations.map(item => [item.id, item.title]));
const rewards = new Map(course.rewardCatalog.map(item => [item.sourceRankId, item.title]));
const markdownCell = value => String(value || '').replaceAll('|', '\\|').replaceAll('\n', '<br>');

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
  '## 九阶段位地图',
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
    lines.push(`**段位作品：${project.title}**`, '', project.story, '');
    const fullyGuided = project.guidancePolicy || project.chapters.some(chapter => chapter.guidedSteps?.length);
    if (fullyGuided) {
      if (project.guidancePolicy) {
        const conceptLessons = project.guidancePolicy.conceptLessonsPerChapter || 0;
        const chapterParts = [
          ...(conceptLessons ? [`${conceptLessons} 个概念理解课`] : []),
          `${project.guidancePolicy.guidedLessonsPerChapter} 个完整引导步骤`,
          ...(project.guidancePolicy.independentCheckpointPerChapter ? ['1 个独立检查'] : [])
        ];
        lines.push(
          `- 课程模式：${project.guidancePolicy.mode}`,
          `- 每章结构：${chapterParts.join(' + ')}`,
          `- 每章概念课：${conceptLessons} 个`,
          `- 完整解法：${project.guidancePolicy.fullSolutionScope}`,
          `- 自主边界：${project.guidancePolicy.learnerFreedomBoundary}`,
          ''
        );
      }
      if (project.estimatedSessions) {
        lines.push(
          `- 预计场次：章节最低 ${project.estimatedSessions.minimum} 场，含 Boss 典型共 ${project.estimatedSessions.typical} 场`,
          ''
        );
      }
      if (project.environment) {
        lines.push(
          `- 开发环境：${project.environment.platform} · ${project.environment.languageStandard} · ${project.environment.toolchain} · ${project.environment.buildSystem}`,
          `- 输出：${project.environment.outputBackend}`,
          `- 输入：${project.environment.inputBackend}`,
          ''
        );
      }
      lines.push('| 章节 | 阶段 | 场次 | 可运行里程碑 | 独立检查 |', '|---|---|---:|---|---|');
      for (const chapter of project.chapters) lines.push(`| ${[chapter.title, chapter.phase || '累积构建', chapter.estimatedSessions || '—', chapter.milestone || chapter.goal, chapter.checkpoint.task].map(markdownCell).join(' | ')} |`);
      lines.push('');
      for (const [chapterIndex, chapter] of project.chapters.entries()) {
        if (!chapter.guidedSteps?.length) continue;
        lines.push(`#### ${chapterIndex + 1}. ${chapter.title}`, '', chapter.guidedBuild, '', `涉及文件：${(chapter.filesTouched || []).map(file => `\`${file}\``).join('、')}`, '');
        if (chapter.conceptModule) {
          const concept = chapter.conceptModule;
          lines.push(
            `##### 概念理解课：${concept.title}`,
            '',
            `- 学习目标：${concept.learningGoal}`,
            `- 先观察：**${concept.phenomenon.title}** — ${concept.phenomenon.observation}`,
            `- 带着问题：${concept.phenomenon.question}`,
            `- 心智模型：${concept.mentalModel.summary}`,
            ''
          );
          concept.mentalModel.flow.forEach((node, nodeIndex) => {
            lines.push(`${nodeIndex + 1}. **${node.title}**：${node.explanation}`);
          });
          lines.push('', '| 术语 | 白话解释 | 代码映射 |', '|---|---|---|');
          concept.terms.forEach(term => {
            lines.push(`| ${markdownCell(term.term)} | ${markdownCell(term.plainMeaning)} | ${markdownCell(term.codeMapping)} |`);
          });
          lines.push('', `- 推演示例：**${concept.workedExample.title}**`);
          concept.workedExample.steps.forEach((step, stepIndex) => {
            lines.push(`  ${stepIndex + 1}. ${step}`);
          });
          lines.push(`- 推演结论：${concept.workedExample.takeaway}`, '', '**理解题（课程后台审阅版）**', '');
          concept.checks.forEach((check, checkIndex) => {
            const correct = check.options.find(option => option.id === check.correctOptionId);
            lines.push(`${checkIndex + 1}. ${check.question}`);
            check.options.forEach(option => {
              lines.push(`   - ${option.id === check.correctOptionId ? '✓ ' : ''}${option.text}`);
            });
            lines.push(`   - 正确答案：${correct?.text || check.correctOptionId}`, `   - 解释：${check.explanation}`);
          });
          lines.push('', `- 进入代码：${concept.bridgeToCode}`, '');
        }
        chapter.guidedSteps.forEach((step, stepIndex) => {
          lines.push(`${stepIndex + 1}. **${step.title}**：${step.instruction}`, `   - 文件：${step.targetFiles.map(file => `\`${file}\``).join('、')}`, `   - 验证：${step.verify}`);
        });
        lines.push('', `- 编译：${chapter.runbook.buildCommands.map(command => `\`${command}\``).join('；')}`, `- 操作：${chapter.runbook.runActions.join('；')}`, `- 预期：${chapter.runbook.expectedResults.join('；')}`, `- 独立检查：${chapter.checkpoint.task}`, `- 证据：${chapter.checkpoint.evidence}`, '');
      }
    } else {
      lines.push('| 章节 | 目标 | 独立检查 |', '|---|---|---|');
      for (const chapter of project.chapters) lines.push(`| ${chapter.title} | ${chapter.goal} | ${chapter.checkpoint.task} |`);
    }
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

const destination = process.env.EGGY_PLAN_EXPORT_DESTINATION
  ? resolve(process.env.EGGY_PLAN_EXPORT_DESTINATION)
  : join(root, 'docs/当前学习训练计划.md');
await writeFile(destination, `${lines.join('\n')}\n`, 'utf8');
console.log(`已导出 ${destination}`);
