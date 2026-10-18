import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  learnerCodeStep,
  materializeProjectState,
  sanitizeProjectCodePackage
} from '../lib/project-code-delivery.mjs';
import { sanitizeProject } from '../shared/park-domain.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const projectId = 'dinosaur-night-patrol-project';

async function readTree(directory, prefix = '') {
  const files = {};
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(files, await readTree(directory, path));
    else if (entry.isFile()) files[path] = await readFile(join(directory, path), 'utf8');
  }
  return files;
}

async function fixture() {
  const detail = JSON.parse(await readFile(join(root, 'data/levels/dinosaur-night-patrol-project.json'), 'utf8'));
  const course = JSON.parse(await readFile(join(root, 'data/course.json'), 'utf8'));
  const project = sanitizeProject(detail);
  const bytes = await readFile(join(root, 'data', project.codeDelivery.packageFile));
  const codePackage = sanitizeProjectCodePackage(JSON.parse(bytes), project);
  return { detail, mirror: course.projects.find(item => item.id === projectId), project, bytes, codePackage };
}

test('恐龙蛋的十二章发布连续完整快照，课程详情与索引引用同一代码包', async () => {
  const { detail, mirror, project, bytes, codePackage } = await fixture();
  assert.deepEqual(mirror, detail);
  assert.equal(project.version, 3);
  assert.equal(project.guidancePolicy.codeDeliveryContractVersion, 1);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), project.codeDelivery.packageSha256);
  assert.equal(codePackage.steps.length, 36);
  assert.equal(codePackage.states.length, 37);

  let files = materializeProjectState(codePackage, project.codeDelivery.baselineStateId);
  for (const [index, step] of codePackage.steps.entries()) {
    const authored = project.chapters.flatMap(chapter => chapter.guidedSteps)[index];
    assert.deepEqual([...step.copyFiles].sort(), [...authored.targetFiles].sort());
    const card = learnerCodeStep(codePackage, step.id);
    files = { ...files, ...card.files };
    assert.deepEqual(files, materializeProjectState(codePackage, step.toStateId), `${step.id} 复制后必须得到下个完整工程`);
    assert.deepEqual(step.intentionalGaps, []);
    assert.ok(step.learnerChanges.length >= 1);
    for (const change of step.learnerChanges) {
      assert.ok(step.copyFiles.includes(change.file));
      assert.ok(files[change.file].includes(change.anchor));
      assert.doesNotMatch(change.expectedFragment, /LEARNER_CHECK|\/\*|\/\//, `${step.id} 不能用注释冒充学习者改动`);
      assert.match(change.instruction, /改|增加|加入|换|调|收紧|发送|格式化|设置|赋值|再读|断言/);
    }
    for (const content of Object.values(files)) {
      assert.doesNotMatch(content, /TODO(?:\([^\n)]*\))?|YOUR_CODE_HERE|IMPLEMENT_ME|<待补全>|\/\*\s*省略[^*]*\*\//);
    }
  }
  assert.equal(codePackage.steps.at(-1).toStateId, project.codeDelivery.finalStateId);
});

test('最终下载快照逐文件等于通过 Docker 验证的 Linux 参考工程', async () => {
  const { project, codePackage } = await fixture();
  const published = materializeProjectState(codePackage, project.codeDelivery.finalStateId);
  const authored = await readTree(join(root, 'courseware/dinosaur-night-patrol/final'));
  assert.deepEqual(published, authored);
  assert.match(authored['README.md'], /为什么第一步就有完整脚手架/);
  assert.match(authored['README.md'], /复制本步完整文件.*有界修改.*运行本章测试.*保存章末快照/);
});
