// The card gets screenshotted. Receipts keep the human's words but lose the internals:
// paths, URLs and code identifiers become placeholders. `--unmask` shows them verbatim.

const URL = /\bhttps?:\/\/\S+/g;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;
const BACKTICK = /`[^`\n]+`/g;
const PATH = /(?:~|\.{1,2})?\/?(?:[\w@.-]+\/)+[\w@.-]+/g;
const FILE =
  /\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|go|py|rs|java|kt|swift|rb|php|cs|cpp|cc|c|h|json|ya?ml|toml|md|css|scss|html|sql|sh|proto|graphql|env)\b/g;
const CAMEL = /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g;
const PASCAL = /\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/g;
const SNAKE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g;
const CALL = /\b[A-Za-z_]\w*\(\)/g;

/** Mixed-case words that are ordinary product names, not code. */
const KEEP = new Set([
  'GitHub',
  'GitLab',
  'TypeScript',
  'JavaScript',
  'macOS',
  'iOS',
  'iPhone',
  'iPad',
  'YouTube',
  'LinkedIn',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'GraphQL',
  'OpenAI',
  'ChatGPT',
  'VSCode',
  'WhatsApp',
  'PayPal',
]);

export function maskForCard(text: string): string {
  return text
    .replace(URL, '‹url›')
    .replace(EMAIL, '‹email›')
    .replace(BACKTICK, '‹code›')
    .replace(PATH, (m) => (/[a-z]/i.test(m) && m.includes('/') ? '‹file›' : m))
    .replace(FILE, '‹file›')
    .replace(CALL, '‹code›')
    .replace(CAMEL, (m) => (KEEP.has(m) ? m : '‹code›'))
    .replace(PASCAL, (m) => (KEEP.has(m) ? m : '‹code›'))
    .replace(SNAKE, '‹code›');
}
