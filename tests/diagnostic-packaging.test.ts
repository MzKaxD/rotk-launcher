import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';

const afterSign = createRequire(import.meta.url)('../scripts/after-sign-diagnostics.cjs') as (context: { appOutDir: string; electronPlatformName: string }) => Promise<void>;
it('refreshes the packaged helper checksum after Authenticode changes its bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rotk-packaging-test-'));
  try {
    const directory = join(root, 'resources', 'diagnostics'); await mkdir(directory, { recursive: true });
    const executable = join(directory, 'ROTK.Diagnostics.exe');
    const bytes = Buffer.from('test PE bytes with an appended signing certificate');
    await writeFile(executable, bytes); await writeFile(`${executable}.sha256`, 'outdated hash');
    await afterSign({ appOutDir: root, electronPlatformName: 'win32' });
    expect(await readFile(`${executable}.sha256`, 'utf8')).toBe(`${createHash('sha256').update(bytes).digest('hex')}  ROTK.Diagnostics.exe\n`);
  } finally {
    if (!resolve(root).startsWith(resolve(join(tmpdir(), 'rotk-packaging-test-')))) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});
