import { request } from 'node:https';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

export interface UploadManifest {
  schemaVersion: 1; localId: string; launcherVersion: string; startedAt: string; endedAt: string;
  files: { name: string; kind: 'text' | 'dump'; bytes: number; sha256: string }[];
}
export interface PreparedUpload { manifest: UploadManifest; paths: string[]; }
type Send = (url: URL, method: string, token: string, body: string | Readable, bytes: number) => Promise<Record<string, unknown>>;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const send: Send = (url, method, token, body, bytes) => new Promise((resolve, reject) => {
  const req = request(url, { method, headers: { Authorization: `Bearer ${token}`,
    'Content-Type': typeof body === 'string' ? 'application/json' : 'application/octet-stream', 'Content-Length': bytes },
    timeout: 120000 }, response => {
    let size = 0; const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 24576) req.destroy(new Error('Diagnostic response too large')); else chunks.push(chunk); });
    response.on('error', reject);
    response.on('end', () => {
      // Never follow redirects with an account credential or upload token.
      if (response.statusCode !== 200) { reject(new Error(`Diagnostic upload refused (${response.statusCode ?? 0})`)); return; }
      try { const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid response');
        resolve(data as Record<string, unknown>);
      } catch { reject(new Error('Invalid diagnostic receipt')); }
    });
  });
  const deadline = setTimeout(() => req.destroy(new Error('Diagnostic upload timeout')), 120000);
  req.on('close', () => { clearTimeout(deadline); if (typeof body !== 'string') body.destroy(); });
  req.on('timeout', () => req.destroy(new Error('Diagnostic upload timeout')));
  req.on('error', reject);
  if (typeof body === 'string') req.end(body); else { body.on('error', error => req.destroy(error)); body.pipe(req); }
});

export async function uploadDiagnostic(prepared: PreparedUpload, origin: string, key: string, transport: Send = send): Promise<string> {
  if (!['https://rotk.app', 'https://test.rotk.app'].includes(origin) || !/^[a-f0-9]{32}$/.test(key)) throw new Error('Diagnostic destination unavailable');
  if (prepared.paths.length !== prepared.manifest.files.length) throw new Error('Incomplete diagnostic upload');
  const root = `${origin}/api/diagnostics/v1/reports`;
  const body = JSON.stringify(prepared.manifest);
  const receipt = await transport(new URL(root), 'POST', key, body, Buffer.byteLength(body));
  if (typeof receipt.id !== 'string' || !ID.test(receipt.id) || typeof receipt.token !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.token)
    || !Array.isArray(receipt.received) || receipt.received.some(index => !Number.isInteger(index) || index < 0 || index >= prepared.paths.length)
    || typeof receipt.complete !== 'boolean') throw new Error('Invalid diagnostic receipt');
  if (!receipt.complete) {
    const started = Date.now();
    for (let index = 0; index < prepared.paths.length; index++) {
      if (receipt.received.includes(index)) continue;
      if (Date.now() - started > 10 * 60000) throw new Error('Diagnostic upload time budget exceeded');
      const file = prepared.manifest.files[index];
      const stream = createReadStream(prepared.paths[index], { ...(file.bytes > 0 ? { start: 0, end: file.bytes - 1 } : {}) });
      try { await transport(new URL(`${root}/${receipt.id}/files/${index}`), 'PUT', receipt.token, stream, file.bytes); }
      finally { stream.destroy(); }
    }
    const completed = await transport(new URL(`${root}/${receipt.id}/complete`), 'POST', receipt.token, '{}', 2);
    if (completed.id !== receipt.id || completed.complete !== true) throw new Error('Diagnostic upload incomplete');
  }
  return receipt.id;
}
