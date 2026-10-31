// Secret patterns. Used to count leaks in prompts now and to redact anything that leaves
// the machine later. Biased towards precision: a false "you leaked 12 keys" is worse than
// missing one.

interface SecretPattern {
  name: string;
  re: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    name: 'private-key',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  },
  { name: 'aws-access-key', re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g },
  { name: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{60,}/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'openai-key', re: /\bsk-(proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g },
  { name: 'stripe-key', re: /\b(sk|rk)_(live|test)_[A-Za-z0-9]{16,}/g },
  { name: 'slack-token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'npm-token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    // `password = "..."`-style assignments whose value looks random: 16+ chars mixing
    // letters and digits, so `token = getToken()` doesn't count.
    name: 'credential-assignment',
    re: /\b(password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?(?!\[REDACTED)(?=[A-Za-z0-9_\-./+]*\d)(?=[A-Za-z0-9_\-./+]*[A-Za-z])[A-Za-z0-9_\-./+]{16,}/gi,
  },
];

export interface Redacted {
  text: string;
  count: number;
}

/** Replaces each secret with `[REDACTED:<kind>]` and counts them. */
export function redactSecrets(text: string): Redacted {
  let count = 0;
  let out = text;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return `[REDACTED:${name}]`;
    });
  }
  return { text: out, count };
}

export function countSecrets(text: string): number {
  return redactSecrets(text).count;
}
