// Reproducible supplemental challenges. Course documents and historical
// attempts stay unchanged; answers are still withheld by learnerLevelContent.
const PREFIX = 'mastery-';

function grading(cases, requiredIdentifiers) {
  return { kind: 'stdin-stdout-cases', cases, requirements: { requiredIdentifiers } };
}

function inputChallenge(round) {
  const bags = 3 + round % 8, items = 5 + Math.floor(round / 8) % 12;
  const source = `#include <stdio.h>
int main(void) {
  int boxes, bags, items;
  if (scanf("%d %d %d", &boxes, &bags, &items) != 3) return 1;
  if (boxes < 0 || boxes > 1000 || bags < 0 || bags >= ${bags} || items < 0 || items >= ${items}) return 1;
  int total = boxes * ${bags * items} + bags * ${items} + items;
  printf("total=%d,parts=%d:%02d:%02d\\n", total, boxes, bags, items);
  return 0;
}
`;
  return {
    prompt: `补星挑战 ${round}：每箱有 ${bags} 袋，每袋有 ${items} 件。读取 boxes、bags、items，要求 boxes 在 0–1000，bags 在 0–${bags - 1}，items 在 0–${items - 1}。输出 total=T,parts=B:DD:DD（袋数和件数补成两位）；无效或缺失输入以状态 1 结束且不输出。`,
    starterFiles: { 'main.c': '#include <stdio.h>\nint main(void) {\n  /* 独立完成读取、校验、换算和格式化输出 */\n  return 0;\n}\n' },
    grader: grading([
      { stdin: '2 1 1\n', stdout: `total=${2 * bags * items + items + 1},parts=2:01:01\n` },
      { stdin: '0 0 0\n', stdout: 'total=0,parts=0:00:00\n' },
      { stdin: `1000 ${bags - 1} ${items - 1}\n`, stdout: `total=${1001 * bags * items - 1},parts=1000:${String(bags - 1).padStart(2, '0')}:${String(items - 1).padStart(2, '0')}\n` },
      { stdin: `1 ${bags} 0\n`, stdout: '', exitCode: 1 },
      { stdin: '1001 0 0\n', stdout: '', exitCode: 1 },
      { stdin: '1 -1 0\n', stdout: '', exitCode: 1 },
      { stdin: '1 0\n', stdout: '', exitCode: 1 }
    ], ['scanf', 'if', 'printf']),
    fullSolution: source
  };
}

function loopChallenge(round) {
  const threshold = 50 + round % 40;
  const source = `#include <stdio.h>
int main(void) {
  int n;
  if (scanf("%d", &n) != 1 || n < 0 || n > 8) return 1;
  int above = 0, sum = 0;
  for (int i = 0; i < n; i++) {
    int value;
    if (scanf("%d", &value) != 1 || value < 0 || value > 100) return 1;
    if (value >= ${threshold}) { above++; sum += value; }
  }
  printf("above=%d,sum=%d\\n", above, sum);
  return 0;
}
`;
  return {
    prompt: `补星挑战 ${round}：读取 n（0–8）和 n 个数（每个 0–100）。只统计大于或等于 ${threshold} 的数，输出 above=A,sum=S，其中 sum 只累加符合条件的数。n=0 输出 above=0,sum=0。无效或缺失输入以状态 1 结束且不输出。`,
    starterFiles: { 'main.c': '#include <stdio.h>\nint main(void) {\n  /* 独立完成循环、条件统计及输入校验 */\n  return 0;\n}\n' },
    grader: grading([
      { stdin: `4\n${threshold - 1} ${threshold} ${threshold + 1} 0\n`, stdout: `above=2,sum=${2 * threshold + 1}\n` },
      { stdin: '0\n', stdout: 'above=0,sum=0\n' },
      { stdin: '8\n100 100 100 100 100 100 100 100\n', stdout: 'above=8,sum=800\n' },
      { stdin: `1\n${threshold - 1}\n`, stdout: 'above=0,sum=0\n' },
      { stdin: '9\n', stdout: '', exitCode: 1 },
      { stdin: '1\n101\n', stdout: '', exitCode: 1 },
      { stdin: '2\n50\n', stdout: '', exitCode: 1 }
    ], ['scanf', 'for', 'if', 'printf']),
    fullSolution: source
  };
}

function functionChallenge(round) {
  const unit = 2 + round % 97;
  const source = `#include <stdio.h>
int floor_to_pack(int value) {
  return value - value % ${unit};
}
int main(void) {
  int value;
  if (scanf("%d", &value) != 1 || value < 0 || value > 1000000) return 1;
  printf("result=%d\\n", floor_to_pack(value));
  return 0;
}
`;
  return {
    prompt: `补星挑战 ${round}：实现 floor_to_pack(value)，将非负整数向下取整为 ${unit} 的倍数。main 读取一个 0–1000000 的整数，调用函数并输出 result=R。无效或缺失输入以状态 1 结束且不输出。例：${unit + 1} 输出 result=${unit}。`,
    starterFiles: { 'main.c': '#include <stdio.h>\nint floor_to_pack(int value) {\n  /* 按本题的倍数规则实现函数合同 */\n  return 0;\n}\nint main(void) {\n  /* 读取、校验并调用函数输出结果 */\n  return 0;\n}\n' },
    grader: grading([
      { stdin: '0\n', stdout: 'result=0\n' },
      { stdin: `${unit - 1}\n`, stdout: 'result=0\n' },
      { stdin: `${unit}\n`, stdout: `result=${unit}\n` },
      { stdin: `${2 * unit + 1}\n`, stdout: `result=${2 * unit}\n` },
      { stdin: '1000000\n', stdout: `result=${1000000 - 1000000 % unit}\n` },
      { stdin: '-1\n', stdout: '', exitCode: 1 },
      { stdin: '1000001\n', stdout: '', exitCode: 1 },
      { stdin: 'x\n', stdout: '', exitCode: 1 }
    ], ['floor_to_pack', 'scanf', 'if', 'printf']),
    fullSolution: source
  };
}

const factories = {
  'quail-fountain-sequence': inputChallenge,
  'quail-piano-output': loopChallenge,
  'quail-opening-broadcast': functionChallenge
};

export function supportsMasteryChallenges(levelId) { return Boolean(factories[levelId]); }

function roundOf(id) {
  const match = /^mastery-([1-9]\d{0,5})$/.exec(id || '');
  return match ? Number(match[1]) : 0;
}

export function withMasteryChallenges(course, progress, submitted = null) {
  const result = structuredClone(course);
  for (const level of result.levels) {
    const factory = factories[level.id];
    if (!factory) continue;
    const step = level.content?.steps?.find(step => step.type === 'independent-variation');
    if (!step) continue;
    const attempts = (progress.attempts || []).filter(attempt => attempt.kind === 'level'
      && attempt.payload.levelId === level.id && attempt.payload.contentVersion === level.version && attempt.payload.stepId === step.id);
    const exposed = new Set(attempts.filter(attempt => attempt.payload.viewedFullAnswer).map(attempt => attempt.payload.variantId));
    const rounds = [...exposed].map(roundOf);
    const completed = attempts.some(attempt => attempt.result.levelCompleted);
    const earned = progress.awardLedger.some(award => award.kind === 'star' && award.activityId === level.id);
    const append = round => {
      const id = `${PREFIX}${round}`;
      if (!step.variants.some(variant => variant.id === id)) step.variants.push({ id, ...factory(round) });
    };
    if (completed && !earned && step.variants.every(variant => exposed.has(variant.id))) {
      append(Math.max(0, ...rounds) + 1);
      // Hints apply to all supplemental forms without leaking their implementation.
      step.hints = [
        { tier: 1, kind: 'observation-focus', text: '先按当前题目写出正常、边界和非法输入的预期结果。' },
        { tier: 2, kind: 'code-region', text: '先检查输入和范围，再检查计算、循环或函数返回值是否遵守当前题目的规则。' },
        { tier: 3, kind: 'cause-and-direction', text: '对照输出字段、补零格式和循环次数；不要直接复制旧变式的常量和公式。' }
      ];
    }
    const submittedRound = roundOf(submitted?.variantId);
    if (submitted?.levelId === level.id && submitted?.stepId === step.id && submittedRound
      && attempts.some(attempt => attempt.payload.variantId === submitted.variantId)) append(submittedRound);
  }
  return result;
}
