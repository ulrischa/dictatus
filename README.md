# Dictatus

A lightweight, installable, offline-first dictation and Markdown editor. Plain HTML, CSS and JavaScript. No dependencies, build tooling, accounts, or backend are required.

## Features

- Start/stop browser-based dictation in the browser's language (`navigator.language`).
- **On-device first:** check for local speech recognition and try to install the required language pack. If it is unavailable or installation fails, fall back to the browser's default speech-recognition service.
- Show **Offline recognition** for a confirmed on-device session; show **Browser service · may be online** if the browser controls recognition. The latter may send audio to a remote provider; the app cannot reliably determine where the browser processes it.
- Edit previously recognized text **while dictation continues**. Final results insert at the current textarea cursor position, advancing the caret for the next phrase. Move the cursor to dictate into an earlier paragraph. Existing selections are preserved (dictation inserts after the selection). Interim hypotheses appear immediately near the recording status and below the editor; they may change before finalization.
- Markdown toolbar appears when the editor receives focus.
- Autosaved draft and local archive using `localStorage` (only text, not audio recordings).
- Copy text, use Web Share when supported, export a Markdown file, import TXT/Markdown, and import/export a JSON archive.
- Install as a PWA; the service worker caches the app shell for offline access.
- Migrates storage from the previous single-file dictation editor (`diktat_single_file_v1`) when the browser origin is unchanged; also imports its JSON exports.

## Setup

Copy the repository contents into a folder named `dictatus` on any HTTPS web server. Open `/dictatus/`, then choose **Install app** in your browser if offered. There is no server-side application to run. For local development, serve this folder from `http://localhost` (for example, `python -m http.server 8000` in the repository directory).

**PWA installation and service workers do not work from a `file://` URL.** Chromium requires HTTPS or localhost for PWA installation. Web servers should serve `.webmanifest` as `application/manifest+json` or `application/json`.

## Speech recognition and privacy

The Web Speech API and microphone permission must be enabled in the browser. Dictatus does not use Windows Voice Typing or the Outlook dictation feature, but corporate/browser policies may still disable speech recognition or microphone access.

Recognition latency depends on the browser engine, speech segmentation (often a pause before final text), the microphone, and possibly a remote service. Dictatus enables interim results and displays them as soon as the browser provides them; JavaScript cannot force the browser to finalize words sooner.

Local recognition depends on experimental browser support and the availability of language packs; `SpeechRecognition.available()` and `SpeechRecognition.install()` may be unavailable or blocked. On-device packs may need an initial download. If local recognition fails, Dictatus uses the browser's speech-recognition service where supported. **Browser service does not guarantee offline operation or local audio processing.** The fallback is explicit in the UI.

The installed PWA shell and text-editing features work offline after the first successful cache installation. Dictation works offline **only when actual on-device recognition is supported and the language pack is installed**. Browser storage is bound to the page's origin and can be deleted by browser settings or data clearing. Export JSON backups regularly.

## Data formats

`Export archive` writes a `dictatus-YYYY-MM-DD.json` file containing notes and any unfiled draft. `Import` merges JSON notes by ID (existing IDs are skipped). Legacy exports (`app: "diktat-single-file"`, version 1) are also accepted. TXT and Markdown imports create a new archived note.

## Development

The entire editor implementation is embedded in `index.html` for straightforward inspection and maintenance. `manifest.webmanifest`, `service-worker.js` and PNG icons are only for PWA integration. No third-party JavaScript or CSS is loaded.

## License

MIT (see LICENSE).
