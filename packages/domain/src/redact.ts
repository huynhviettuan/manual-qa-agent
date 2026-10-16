// Applied before content is indexed, sent to a model, or logged. Conservative by design:
// a false positive costs a little context; a false negative leaks a credential.
const PATTERNS: Array<[RegExp, string]> = [
  [/\b(authorization\s*:\s*)?bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, '[REDACTED_BEARER]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\b(set-cookie|cookie)\s*:[^\n]*/gi, '[REDACTED_COOKIE]'],
  [/\b(api[_-]?key|secret|token|password|passwd|pwd)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi, '$1$2[REDACTED]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]'],
];

// `[secret:NAME]` is how executable steps refer to a secret by reference; it holds a name, not a
// value. Only this exact form is spared, so `[password: hunter2]` is still redacted.
const SECRET_REFERENCE = /\[secret:([A-Z][A-Z0-9_]{1,63})\]/g;
const REFERENCE_PLACEHOLDER = /\{\{secret-reference:([A-Z][A-Z0-9_]{1,63})\}\}/g;

export function redactSecrets(text: string): { text: string; redactions: number } {
  let redactions = 0;
  let out = text.replace(SECRET_REFERENCE, '{{secret-reference:$1}}');
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, (...args) => {
      redactions++;
      const groups = args.slice(1, -2) as Array<string | undefined>;
      return replacement.replace(/\$(\d)/g, (_m, i: string) => groups[Number(i) - 1] ?? '');
    });
  }
  return { text: out.replace(REFERENCE_PLACEHOLDER, '[secret:$1]'), redactions };
}

/** Rough token estimate (≈4 chars/token) for budgeting; not a billing figure. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
