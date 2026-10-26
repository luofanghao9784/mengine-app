/**
 * Masks credentials that employees paste into messages, so a shared screen or screenshot does not
 * expose them. Display only: what was sent is unchanged. Keeps a short recognisable prefix.
 */
const patterns: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // model provider keys
  /\bAKIA[0-9A-Z]{16}\b/g, // cloud access key ids
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, // code-hosting tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, // chat workspace tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWTs
  /\b(?:Bearer|token)\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
];
const labelled =
  /((?:password|passwd|pwd|secret|api[_-]?key|access[_-]?key|token|密码|口令|密钥)\s*[:：=]\s*)(\S{4,})/gi;

const hide = (value: string) => value.slice(0, 4) + '•'.repeat(Math.min(12, Math.max(4, value.length - 4)));

export function maskSecrets(text: string) {
  let out = text.replace(labelled, (_, label: string, value: string) => label + hide(value));
  for (const pattern of patterns) out = out.replace(pattern, (match) => hide(match));
  return out;
}
