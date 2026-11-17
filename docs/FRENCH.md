# French interface catalogue

The desktop interface offers Portuguese, English and French. French UI strings, keyed labels and coded errors are bundled locally in `src/shared/french.json`; the running app does not request translations from an API. The chosen interface language is persisted as `settings.appLanguage`. Spoken-language selection is independent.

`src/shared/french-overrides.json` contains reviewed terminology, corrections and new short labels. Apply these overrides after regenerating the catalogue. Date/status helpers and native menus have their own French wording in `format.mjs`, `handlers.js` and `index.js`.

To update the generated catalogue:

1. Add source text to the English UI catalogue or keyed/error dictionaries.
2. Run `node scripts/extract-interface-translations.mjs` from `desktop`. This creates the ignored `scripts/.french-source.json` input.
3. Run `backend/.venv/Scripts/python.exe desktop/scripts/translate-interface-french.py` from the workspace root. This build-time helper uses the backend's configured language service and sends only static interface strings. It resumes completed batches, checks interpolation variables and brand names, and applies the reviewed overrides. `--model` can select an available model on that configured service.
4. Review the French wording and run the catalogue tests and UI checks. Model-generated translations still require review; preserve product names, technical identifiers and interpolation variables exactly.

Validation:

- `node --test test/french-interface.test.mjs test/i18n-coverage.test.mjs`
- `npm test` and `npm run build`
- `electron scripts/french-interface-smoke.js` verifies selection from the real Settings screen, translated navigation, persistence after reload and an unchanged spoken-language setting, using a temporary profile.

The landing page has its own French copy and a dropdown linking `/`, `/en/` and `/fr/`. The browser check `scripts/landing-languages-smoke.js` verifies route selection, preservation of the section anchor and mobile layout.
