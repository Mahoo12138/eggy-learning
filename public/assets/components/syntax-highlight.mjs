const loaders = {
  c: () => import('../../vendor/highlightjs/languages/c.min.js'),
  cpp: () => import('../../vendor/highlightjs/languages/cpp.min.js'),
  bash: () => import('../../vendor/highlightjs/languages/bash.min.js'),
  json: () => import('../../vendor/highlightjs/languages/json.min.js'),
  javascript: () => import('../../vendor/highlightjs/languages/javascript.min.js'),
  sql: () => import('../../vendor/highlightjs/languages/sql.min.js')
};
const aliases = { 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', sh: 'bash', shell: 'bash', js: 'javascript' };
const languages = new Map();
let core;
export const MAX_HIGHLIGHT_LENGTH = 64 * 1024;
export const escapeCode = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function codeLanguage(value) {
  const key = String(value || '').trim().toLowerCase();
  const language = Object.hasOwn(aliases, key) ? aliases[key] : key;
  return Object.hasOwn(loaders, language) ? language : 'plaintext';
}

export async function highlightCode(value, requestedLanguage) {
  const code = String(value ?? '');
  const language = codeLanguage(requestedLanguage);
  const plain = { html: escapeCode(code), language, state: 'plain' };
  if (code.length > MAX_HIGHLIGHT_LENGTH) return { ...plain, state: 'oversize' };
  if (!code || language === 'plaintext') return plain;
  try {
    core ||= import('../../vendor/highlightjs/core.min.js').then(module => module.default.newInstance()).catch(error => { core = undefined; throw error; });
    const highlighter = await core;
    if (!languages.has(language)) {
      languages.set(language, loaders[language]().then(module => highlighter.registerLanguage(language, module.default)).catch(error => { languages.delete(language); throw error; }));
    }
    await languages.get(language);
    return { html: highlighter.highlight(code, { language, ignoreIllegals: true }).value, language, state: 'highlighted' };
  } catch (error) {
    // Highlighting is optional presentation; source and native editing stay available.
    return { ...plain, state: 'unavailable', error };
  }
}
