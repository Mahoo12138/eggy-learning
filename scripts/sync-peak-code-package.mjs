// Rebuild the published source package from authored cumulative C++ snapshots.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { publishProjectCode, prepareSnapshotProject } from '../lib/project-code-publisher.mjs';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check')) throw new Error('仅支持 --check');
const root = fileURLToPath(new URL('..', import.meta.url));
const result = await publishProjectCode({
  root, projectId: 'peak-delivery-center-project', check: args.includes('--check'),
  build: async ({ project }) => prepareSnapshotProject(project,
    JSON.parse(await readFile(join(root, 'courseware/peak-delivery-center/manifest.json'), 'utf8')),
    {
      baselineStateId: 'peak-empty',
      finalSource: {
        buildCommands: ['make'],
        runCommands: ['make test', 'make run', 'make benchmark'],
        expected: ['全部功能与异常场景检查通过；失败时返回非零退出码。', '配送结果、库存和关店统计可核对；计算优化与并行版本的结果等于串行基准。', '基准输出实际测量结果；速度由硬件与负载决定，不要求固定加速倍数。']
      }
    })
});
console.log(`${result.check ? '校验通过，未写入' : result.written ? '已同步' : '内容未变，未写入'}：${result.chapters} 节、${result.steps} 个完整代码增量，课程版本 ${result.publishedRevision}。`);
