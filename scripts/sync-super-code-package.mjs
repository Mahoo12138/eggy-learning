// --with-draft also publishes authored prose; --check only validates the candidate.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { publishProjectCode, prepareSnapshotProject } from '../lib/project-code-publisher.mjs';

const args = process.argv.slice(2);
if (args.some(arg => !['--with-draft', '--check'].includes(arg))) throw new Error('仅支持 --with-draft 和 --check');
const root = fileURLToPath(new URL('..', import.meta.url));
const readJSON = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const result = await publishProjectCode({
  root, projectId: 'super-arcade-data-center-project', check: args.includes('--check'),
  build: async ({ project }) => {
    const authored = args.includes('--with-draft') ? await readJSON('courseware/super-curriculum-draft.json') : project;
    const manifest = await readJSON('courseware/super-arcade-data-center/manifest.json');
    const prepared = prepareSnapshotProject(authored, manifest, {
      baselineStateId: 'super-empty',
      finalSource: {
        buildCommands: manifest.finalSource?.buildCommands || ['make'],
        runCommands: manifest.finalSource?.runCommands || ['make test', 'make run'],
        expected: manifest.finalSource?.expected || ['网络故障、事务、重复请求与重启恢复检查通过；失败时返回非零退出码。', 'C 终端经 C 网关访问 C++ 服务，积分写入 SQLite 后可以查询。']
      }
    });
    return { ...prepared, rankTechnologyTheme: authored.technologyTheme };
  }
});
console.log(`${result.check ? '校验通过，未写入' : result.written ? '已同步' : '内容未变，未写入'}：${result.chapters} 节、${result.steps} 个完整代码增量，课程版本 ${result.publishedRevision}。`);
