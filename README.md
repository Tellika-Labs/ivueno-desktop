# Ivueno desktop

Electron + React app (Windows first). Design: `project-design/` (open the boards for reference; do not ship them).

```
npm install
npm run build && npm start      # run the built app
npm run dev                     # Vite dev server + Electron (hot reload)
npm test                        # 257 tests (no Electron needed); the backend integration test needs ../backend/.venv
```

Sign-in needs the backend: from `../backend`, `.venv\Scripts\python -m uvicorn app.main:app --port 8000`
(set `IVUENU_DEV_ENDPOINTS=true` to switch plans without paying). Change the address with `IVUENU_API_BASE`.

WiPay checkout now opens inside the payment screen, using the hosted page and countdown in a sandboxed iframe. The main process validates the checkout URL and restricts frame navigation to the two WiPay hosts, plus Cloudflare verification frames nested inside those checkout pages. An explicit **Open in browser** button continues the same payment if needed. The app polls the backend and refreshes the licence only after a verified payment; page messages and return redirects cannot activate a plan. English and French checkout text are included. This follows WiPay's [embedding documentation](https://developer.wipay.ao/#embedding); its published API does not document direct initiation from a fully custom payment form.

`scripts/embedded-checkout-smoke.js` exercises the checkout in Electron with local provider fixtures and the production CSP. It checks that input/countdown state survives polling, remote frames have no app bridge or Node access, foreign frame destinations are blocked, browser fallback reuses the payment, return navigation does not activate access, and backend confirmation refreshes the licence. Its result and screenshot are saved under an ignored `.payment-smoke-*` directory. It makes no provider requests or charges.

## Status (2026-10-22)

**Built and tested; no installer yet.** Used for a first real meeting (the findings went into the design: see `../docs/CLOUD_AI.md`). It needs more real use before launch.

- **Recording:** live meetings (microphone and the computer's sound), with a choice of where the people are (same room, a call, both); a recording bar that stays on top; pause and resume; dictation into any app with a hotkey; a warning when the call's sound is silent.
- **Import:** an audio file up to 4 hours, transcribed in pieces, with voices told apart and notes written.
- **AI:** all in the cloud, through the Ivueno server (Groq): speech, notes, summaries, follow-up emails, meeting type, questions. If the server cannot be reached, plain rule-based writers are used for text and are labelled as such. Nothing is invented offline.
- **Voices:** a small local model (TitaNet, 40 MB, downloaded once with the person's consent) separates people on imports and, from the kept audio, in same-room meetings.
- **Kept audio:** the audio of a meeting is kept on this computer for the time the person chooses (7 days by default) and used to tell voices apart after the meeting; transcribing again is on request. Everything is under Definições › Gravação.
- **Notes:** seven meeting types (including formal minutes), detected automatically or chosen; tasks; chat and recipes; export to text, Markdown, Word and PDF; sharing; a follow-up email that opens in the person's own mail program.
- **Account and plans:** sign-in, offline-verified licence, plans and checkout (Multicaixa Express, EMIS reference; WiPay is built and off), payment history.
- **Sync:** encrypted copy between computers on paid plans; the app asks once for the passphrase; linking a phone with a QR code (the image needs the `qrcode` package, until then the link is shown as text) and the rule for when the phone sends.
- **Interface:** Portuguese, English and French, light and dark, header and tabs fixed with only the page body scrolling, centred dialogs. Choose Français under Settings → Profile → App language; this is independent of the meeting's spoken language.

- **Shared folders (Team and Enterprise):** share a folder with the organisation from the folder's button in the sidebar. The app uploads a readable copy of each finished meeting in it (the encrypted sync copy cannot be read by teammates) and keeps it up to date; stopping removes the copies. Teammates' folders appear under "Shared with me", read-only, with a question box. See `src/main/sharing.js`.

Not built: installer, auto-update, code signing, macOS build, auto-start from the calendar or call detection, a screen for personal notes made on the phone.

## Layout

- `src/main/` main process, no UI. `handlers.js` is every call the pages can make; `session.js` is the one recording; `repo.js`/`store.js` hold an encrypted local store with atomic writes and an OS-protected key; `licence.js` verifies the signed licence offline.
  - `engine/` the cloud engine (`cloud.js`), the router that chooses it, the plain fallback writers (`demo.js`, `summarize.js`, `email.js`, `mtype.js`) and the vocabulary hint (`vocab.js`).
  - `importer.js` audio import; `voices.js` + `voices-worker.js` telling voices apart (in a worker thread); `audio-archive.js` the kept audio and how long it stays; `refiner.js` what is done with it after a meeting.
  - `sync.js` encrypted sync; `pairing.js` and `qr.js` linking a phone; `dictation.js`; `usage.js`.
- `src/preload/` the only bridge to the pages (a list of allowed events). `src/renderer/` the screens (`screens/`), shared parts (`components/`), helpers (`lib/`: audio capture, pause cutting, decoding, i18n).
- `test/` one file per area. The Python reference for the phone pairing is checked by a known-answer vector in `test/pairing.test.js`.

## Packaging notes (not done yet)

Imported files first use the browser decoder, then the bundled `ffmpeg-static@5.3.0` executable when a codec/container is unsupported (including MP4/M4A). Decoding stays local; temporary input and PCM files are removed afterwards. Large files still go to transcription as WAV pieces, with local PCM for speaker separation. The regression check `scripts/import-mp4-smoke.js` exercises the real dialog with a 49.5 MB MP4 and seven requested speakers, using a fake speech service.

Unpack `node_modules/ffmpeg-static/**` from ASAR and include its executable, `ffmpeg[.exe].LICENSE` and `ffmpeg[.exe].README`. See [FFmpeg distribution details](docs/FFMPEG.md) for the exact Windows binary, license/source information and mirror settings. A system FFmpeg installation is not required.

`sherpa-onnx-node` (and its platform package) and `src/main/voices-worker.js` must be unpacked from the asar (`asarUnpack`). The voice model file is looked up in the app data and in `~/.ivuenu/models/diarization/`; host it ourselves and set its address in `src/main/voices.js` before release.
