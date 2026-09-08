import { isIP } from 'node:net';

/** Diagnostic exports are a deliberately smaller surface than the private session record. */
const PRIVATE_KEYS = /^(?:installationRoot|logsRoot|directory|snapshot|commandLine|command_line|argv|args|environment|env|playerKey|player_key|launchTicket|sessionId|sessionToken|apiToken|idToken|accessToken|refreshToken|password|authorization|cookie|hwid|email|ipAddress)$/i;
const SENSITIVE_NAME = '(?:session[_-]?(?:id|token)|password|passwd|(?:player|api|auth|access)[_-]?key|(?:access|refresh|api|id)[_-]?token|(?:client[_-]?)?secret|launch[_-]?ticket|ticket|authorization|cookie)';
const SOFTWARE_VERSION = /^\d+(?:\.\d+){1,4}(?:[-+][\w.-]+)?$/;
const VERSION_KEY = /(?:^|[_-])(?:version|fileversion|productversion|driverversion|moduleversion|appversion)$|Version$/i;

function redactPath(value: string): string {
  // Unquoted stack lines can put fault fields after a path. Retain that evidence,
  // while only preserving basenames for executable modules (never user files).
  const split = value.search(/\s+(?=[A-Za-z][\w.-]*\s*[=:])/);
  const path = split < 0 ? value : value.slice(0, split);
  const trailing = split < 0 ? '' : value.slice(split);
  const name = path.split(/[\\/]/).pop() ?? '';
  const module = name.match(/^([\w .()-]+\.(?:dll|exe|sys|pdb))(\+0x[\da-f]+)?(?:\s|$)/i);
  return `[LOCAL_PATH]${module ? `/${module[1]}${module[2] ?? ''}` : ''}${trailing ? redactDiagnosticText(trailing) : ''}`;
}

export function redactDiagnosticText(input: string, knownSecrets: readonly string[] = []): string {
  let text = input;
  text = text.replace(/^.*(?:command[ _-]?line|process[ _-]?arguments|environment[ _-]?(?:variables|dump))\s*["']?\s*[=:].*$/gim, '[SENSITIVE RECORD OMITTED]');
  for (const secret of knownSecrets.filter((value) => value.length >= 4).sort((a, b) => b.length - a.length)) {
    for (const form of new Set([secret, encodeURIComponent(secret), encodeURIComponent(encodeURIComponent(secret))])) {
      text = text.split(form).join('[REDACTED]');
    }
  }
  // Decode only the token prefixes, including double-encoded underscores. Do not
  // decode entire logs: doing so could turn escaped log content into new records.
  text = text.replace(/h1(?:g|l)(?:_|%5[fF]|%255[fF])[A-Za-z0-9_%+/.=~-]+/gi, '[REDACTED_TOKEN]');
  text = text.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/%=-]+/gi, '$1 [REDACTED]');
  text = text.replace(/\b((?:Set-Cookie|Cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]');
  text = text.replace(new RegExp(`(<(${SENSITIVE_NAME}|environment|env|commandLine)\\b[^>]*>)[\\s\\S]*?(<\\/\\2\\s*>)`, 'gi'), '$1[REDACTED]$3');
  text = text.replace(new RegExp(`((${SENSITIVE_NAME})\\s*["']?\\s*(?:=|:)\\s*)(["'])(?:\\\\.|(?!\\3)[^\\r\\n])*?\\3`, 'gi'), '$1$3[REDACTED]$3');
  text = text.replace(new RegExp(`((${SENSITIVE_NAME})\\s*["']?\\s*(?:=|:|%3[dDaA])\\s*["']?)[^\\s"'&,;}<>]+`, 'gi'), '$1[REDACTED]');
  // Local absolute paths can expose a Windows account name, installation layout,
  // or network share. Module basenames and offsets remain useful in stack traces.
  text = text.replace(/\b[A-Za-z]:(?:\\\\|\\|\/)(?:[^\r\n"'<>|;,]|\\["'])+/g, redactPath);
  text = text.replace(/\\\\[^\s"'<>]+/g, '[NETWORK_PATH]');
  text = text.replace(/\b[A-Za-z]:%5[cC][^\s"'&,;]+/g, '[LOCAL_PATH]');
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]');
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?\b/g, (value, offset: number, source: string) => {
    const before = source.slice(Math.max(0, offset - 80), offset);
    if (/(?:\b[\w-]*version|\b(?:file|product|driver|module|app)[ _-]version)["']?\s*(?:[:=]\s*["']?\s*|\s+)$/i.test(before)) return value;
    return value.split(':')[0].split('.').every((part: string) => Number(part) <= 255) ? '[IP]' : value;
  });
  text = text.replace(/(?<![A-Za-z0-9])(?:[a-f\d]{0,4}:){2,}[a-f\d]{0,4}(?:%[\w.-]+)?(?![A-Za-z0-9])/gi, (value) => isIP(value.split('%')[0]) === 6 ? '[IP]' : value);
  return text;
}

export function sanitizeDiagnosticValue(value: unknown, knownSecrets: readonly string[] = [], depth = 0): unknown {
  if (depth > 10) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') return redactDiagnosticText(value.slice(0, 64_000), knownSecrets);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 300).map((item) => sanitizeDiagnosticValue(item, knownSecrets, depth + 1));
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value).slice(0, 150)) {
      if (PRIVATE_KEYS.test(key) || /(?:secret|credential|fingerprint)/i.test(key)) continue;
      result[key] = VERSION_KEY.test(key) && typeof item === 'string' && SOFTWARE_VERSION.test(item)
        ? item : sanitizeDiagnosticValue(item, knownSecrets, depth + 1);
    }
    return result;
  }
  return null;
}
