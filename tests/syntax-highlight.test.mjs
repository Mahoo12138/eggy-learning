import test from 'node:test';
import assert from 'node:assert/strict';
import { codeLanguage, highlightCode, MAX_HIGHLIGHT_LENGTH } from '../public/assets/components/syntax-highlight.mjs';

test('真实 ESM 语言模块按需高亮 C、C++、Shell、JSON、JavaScript 和 SQL', async () => {
  const examples = [
    ['c', 'int main(void) { return 0; }'], ['c++', 'class Box { public: int value = 0; };'],
    ['shell', 'if test -f file; then echo "ok"; fi'], ['json', '{"name": "蛋仔", "count": 2}'],
    ['js', 'const answer = 42;'], ['sql', 'SELECT name FROM users WHERE id = 1;']
  ];
  const results = await Promise.all(examples.map(([language, code]) => highlightCode(code, language)));
  for (const result of results) {
    assert.equal(result.state, 'highlighted');
    assert.match(result.html, /class="hljs-/);
    assert.equal(result.error, undefined);
  }
  assert.equal(codeLanguage(' C++ '), 'cpp'); assert.equal(codeLanguage('sh'), 'bash');
});

test('代码中的 HTML、引号、实体与不完整语法保持为文本', async () => {
  const payload = '#include <stdio.h>\n// <img src=x onerror=alert(1)>\nchar *s = "<script>&amp;</script>";\n/* 未结束注释';
  const result = await highlightCode(payload, 'c');
  assert.equal(result.state, 'highlighted');
  assert.equal(result.html.includes('<img'), false); assert.equal(result.html.includes('<script>'), false);
  assert.match(result.html, /&lt;img/); assert.match(result.html, /&amp;amp;/);
});

test('未知语言、对象键名称、空代码和超长代码安全显示原文', async () => {
  for (const language of ['unknown', '__proto__', 'constructor', 'plaintext']) {
    const result = await highlightCode('<b>中文</b>', language);
    assert.equal(result.state, 'plain'); assert.equal(result.html, '&lt;b&gt;中文&lt;/b&gt;');
  }
  assert.equal((await highlightCode('', 'c')).html, '');
  const large = 'x'.repeat(MAX_HIGHLIGHT_LENGTH + 1);
  const result = await highlightCode(large, 'c');
  assert.equal(result.state, 'oversize'); assert.equal(result.html, large);
});
