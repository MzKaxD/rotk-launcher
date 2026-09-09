import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../resources/diagnostics/PresentMon.exe', import.meta.url));
const expected = '9bec3083069f58f911e6a512f4806db51a27bd096103087bc1d05ef54c80a191';
const [bytes, sidecar, license] = await Promise.all([
  readFile(path), readFile(`${path}.sha256`, 'utf8'),
  readFile(new URL('../resources/diagnostics/PresentMon-LICENSE.txt', import.meta.url), 'utf8'),
]);
if (createHash('sha256').update(bytes).digest('hex') !== expected || sidecar.trim().split(/\s+/)[0] !== expected || !license.includes('Intel Corporation')) {
  throw new Error('Pinned Intel PresentMon 2.5.1 or its license is missing/modified');
}
console.log('Verified official Intel PresentMon 2.5.1 (MIT), pinned SHA256 and license.');
