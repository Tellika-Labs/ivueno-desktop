# Local import decoder

Added 2026-11-04 for imports whose codecs the Electron browser decoder cannot read. The browser remains the first choice. On failure, the main process runs a bundled executable to produce 16 kHz mono PCM16; it does not upload audio during decoding. The existing importer then splits large recordings into WAV pieces for transcription and uses the PCM for local speaker separation.

## Pinned dependency and Windows artifact

- npm dependency: `ffmpeg-static@5.3.0` (production dependency, exact version in package/lock files).
- Package source: <https://github.com/eugeneware/ffmpeg-static>.
- Installer binary release: `b6.1.1`, Windows x64 asset `ffmpeg-win32-x64.gz`.
- Download base: <https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1>.
- Installed executable: FFmpeg `6.1.1-essentials_build-www.gyan.dev`, 82,797,568 bytes.
- Executable SHA-256: `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`.
- Binary README identifies source commit: <https://github.com/FFmpeg/FFmpeg/commit/e38092ef93>.
- npm package declares GPL-3.0-or-later; this Windows binary README identifies GPL v3. Keep the actual binary license/README and the matching source/build materials when distributing it. Other platforms have their own binary/source details. FFmpeg explains build-dependent terms at <https://ffmpeg.org/legal.html>.

The install script downloads the platform executable and its license/README; these files are not contained in the npm source tarball. Ensure install scripts run during dependency setup, and verify the binary exists before packaging. The executable and sidecars must be unpacked from Electron ASAR; `media-decoder.js` resolves `app.asar.unpacked` automatically.

## Mirroring

Add `eugeneware/ffmpeg-static` and its binary release assets to the dependency mirror plan, alongside `FFmpeg/FFmpeg`. Preserve package tarballs, binaries, sidecars and matching source/build configuration. `FFMPEG_BINARIES_URL` can point the install script at an owned release-download base with the same release/asset layout. `FFMPEG_BIN` can point to an explicitly managed local executable. These are trusted process environment settings; the renderer cannot choose commands or paths.

Neither npm tarball integrity nor a Git source fork alone preserves the downloaded executable. Keep its separate checksum in the release manifest. Package upgrades should include the corresponding binary/source/license refresh and the decoder checks.

## Limits and checks

Input is capped at 1.5 GB. Decode time is capped at ten minutes; decoded audio above four hours is rejected. FFmpeg gets no shell, fixed arguments, a private temporary input file, a media-demuxer allowlist and only local file/pipe protocols. The process maps only the first audio stream. Cancellation terminates the child process and cleans up its temporary files. No audio stream, malformed files and playlists are rejected.

Run `node --test test/media-decoder.test.js test/import-decode.test.mjs test/importer.test.js` and the hidden Electron check `electron scripts/import-mp4-smoke.js`. The latter uses a generated AAC MP4 padded with a valid free atom to 49.5 MB and forces a browser codec failure. It verifies native IPC decoding, WAV upload preparation, seven requested speakers, completed import and temporary-audio cleanup. Speech/voices are fakes, so no external uploads or transcription charges occur. It does not validate the user's original recording, which was not attached.
