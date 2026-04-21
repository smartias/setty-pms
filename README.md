# setty-pms

## SETTY Field Photos as a PWA (iPhone + Android, no app store)

`SettyFieldPhotos.html` now includes Progressive Web App support:

- `manifest.webmanifest` defines app identity, icon, standalone display, and launch URL.
- `sw.js` adds offline-first caching for app shell files and same-origin assets.
- iOS/Android mobile web app meta tags are included in the HTML `<head>`.
- A service worker is registered on page load.

### Deploy requirements

To make install work on both iPhone and Android:

1. Host on **HTTPS** (required by service workers and install prompts).
2. Serve these files from the same web root:
   - `SettyFieldPhotos.html`
   - `manifest.webmanifest`
   - `sw.js`
   - `icons/icon.svg`
3. Keep URL stable (do not serve from `file://`).

### Install on iPhone (Safari)

1. Open the hosted URL in Safari.
2. Tap **Share**.
3. Tap **Add to Home Screen**.
4. Launch from home screen (opens in standalone app mode).

### Install on Android (Chrome/Edge)

1. Open the hosted URL.
2. Accept **Install app** prompt, or open browser menu and tap **Install app** / **Add to Home screen**.
3. Launch from app drawer or home screen.
