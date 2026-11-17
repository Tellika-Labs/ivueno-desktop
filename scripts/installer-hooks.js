const fs = require('fs');
const path = require('path');

/** electron-builder's own icon step needs a code-signing toolchain that cannot be unpacked without symlink rights on Windows,
 *  so the app's .exe gets the Ivueno icon here instead of keeping Electron's. */
exports.afterPack = async (context) => {
  if (context.electronPlatformName === 'darwin') return adHocSign(context);
  if (context.electronPlatformName !== 'win32') return;
  const mod = await import('rcedit');
  const rcedit = typeof mod.default === 'function' ? mod.default : mod.default.rcedit;
  const exe = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`);
  await rcedit(exe, { icon: path.join(context.packager.projectDir, 'assets', 'app-icon.ico') });
};

/** macOS: without an Apple Developer ID the app would be left unsigned, and macOS will not give an unsigned app the
 *  microphone (the permission prompt never comes up). Sign it ad hoc, for this build only. With a Developer ID in the
 *  keychain, electron-builder signs it properly afterwards and replaces this signature. */
async function adHocSign(context) {
  const { execFileSync } = require('child_process');
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • signed ad hoc  ${path.basename(app)}`);
}

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
