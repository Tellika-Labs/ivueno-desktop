# Releasing a new version of the desktop app

Installed copies update themselves (`src/main/updater.js`, electron-updater). They read `latest.yml` from
`https://<server>/downloads/` (the `build.publish` address in `package.json`), download the new installer in the
background, and show "Reiniciar e atualizar" when it is ready. If the person just closes the app, it installs then.

## Each release

1. Version: while the app is still at `0.1.0` (the current choice), a new installer replaces the download for **new** people,
   but installed copies are **not** offered an update, because the updater only installs a **higher** version.
   Raise `"version"` in `desktop/package.json` (for example `0.1.1`) when you want installed copies to update.
2. Build: `npm run dist` (needs the code-signing certificate for a real release: see below).
3. Upload with scp from `desktop/release/` (replace `USER` and the host with your server login; the folder is `/srv/ivuenu/downloads/`).
   Send `latest.yml` **last**: it is what tells installed apps a new version exists.
   ```
   scp "release/Ivueno-Setup-<version>.exe" "release/Ivueno-Setup-<version>.exe.blockmap" USER@<server>:/srv/ivuenu/downloads/
   scp release/latest.yml USER@<server>:/srv/ivuenu/downloads/
   ```
4. Copy the new installer to the fixed name the website button uses (on the server):
   ```
   ssh USER@<server> "cp /srv/ivuenu/downloads/Ivueno-Setup-<version>.exe /srv/ivuenu/downloads/Ivueno-Setup.exe"
   ```
   Or upload it directly under that name: `scp "release/Ivueno-Setup-<version>.exe" USER@<server>:/srv/ivuenu/downloads/Ivueno-Setup.exe`.
5. Check: `curl -s https://<server>/downloads/latest.yml` shows the new version, and the site's download button gets the new file.
   If scp makes the files unreadable for nginx, run `chmod 644 /srv/ivuenu/downloads/*` on the server.

nginx (`deploy/nginx/downloads.conf`) already serves any file in that folder with `Cache-Control: no-cache`, so
`latest.yml` is never stale.

## Sign the installer

Updates are only trusted when they come from the same publisher, and an unsigned installer shows "Unknown publisher"
and SmartScreen warnings again on every update. Set `CSC_LINK` / `CSC_KEY_PASSWORD` (or the cloud-signing options) and
`win.publisherName: "Telikka Labs"` before the first public release.

## Good to know

- **The first updater version must be installed by hand.** Copies of 0.1.0 have no updater inside; tell those people to
  download the new installer once. After that, updates are automatic.
- **The update address is baked into each installed app.** The server is currently `https://2-29-200-22.sslip.io`.
  When `api.ivueno.ao` is live, change `build.publish[0].url` **and keep serving the old address** until people have
  updated, or apps built with the old address stop finding updates.
- **Never lower the version** and never overwrite a published `.exe` with different content; publish a new version.
- A development run (`npm run dev`) never checks for updates. Only installed builds do.
- Data migrations run on the first start of the new version (for example, the per-account folders in 0.2.0), so keep
  them safe to run on old data.

## Try an update locally (optional)

Install an older build, serve a folder with a higher-version `latest.yml` + installer over HTTPS (or localhost with
`build.publish.url` pointing to it), start the old app, wait for the "Reiniciar e atualizar" banner.
