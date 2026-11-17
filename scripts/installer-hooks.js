const fs = require('fs');
const path = require('path');

/** electron-builder's own icon step needs a code-signing toolchain that cannot be unpacked without symlink rights on Windows,
 *  so the app's .exe gets the Ivueno icon here instead of keeping Electron's. */
exports.afterPack = async (context) => {
  if (context.electronPlatformName !== 'win32') return;
  const mod = await import('rcedit');
  const rcedit = typeof mod.default === 'function' ? mod.default : mod.default.rcedit;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exe, { icon: path.join(context.packager.projectDir, 'assets', 'app-icon.ico') });
};

/** Leave only the installer in the output folder (the Windows setup .exe, or the macOS .dmg). */
exports.afterAllArtifactBuild = async (result) => {
  const keep = new Set(result.artifactPaths.filter((p) => p.endsWith('.exe') || p.endsWith('.dmg')).map((p) => path.resolve(p)));
  const out = result.outDir;
  for (const name of fs.readdirSync(out)) {
    const full = path.resolve(out, name);
    if (!keep.has(full)) fs.rmSync(full, { recursive: true, force: true });
  }
  return [];
};
