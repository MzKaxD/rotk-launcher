const { createHash } = require('node:crypto');
const { readFile, writeFile, lstat } = require('node:fs/promises');
const { join } = require('node:path');

// electron-builder signs extraResources executables during packaging. Hash the
// final bytes, after Authenticode, so the observer can verify the shipped helper.
module.exports = async function afterSignDiagnostics(context) {
  if (context.electronPlatformName !== 'win32') return;
  const executable = join(context.appOutDir, 'resources', 'diagnostics', 'ROTK.Diagnostics.exe');
  const info = await lstat(executable);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Packaged diagnostic helper is missing or invalid');
  const digest = createHash('sha256').update(await readFile(executable)).digest('hex');
  await writeFile(`${executable}.sha256`, `${digest}  ROTK.Diagnostics.exe\n`, 'ascii');
};
