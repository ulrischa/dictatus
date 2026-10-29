# 👩‍🏫 Dictatus

A lightweight, installable, offline-first dictation and Markdown editor. Plain HTML, CSS and JavaScript. No dependencies, build tooling, accounts, or backend are required.

## Features

- Start/stop browser-based dictation in the browser's language (`navigator.language`).
- **On-device first:** check for local speech recognition and try to install the required language pack. If unavailable or unsuccessful, stop with an error and offer an explicit **Allow online mode** action. No automatic online fallback.
- Show **Not started**, **Checking…**, **Offline**, **Online**, **Paused**, or **Error**. Offline/Online appear only after recognition starts. Online means remote processing is permitted; the browser chooses the actual processing location. Allow online mode explicitly, then tap or hold the dictation button. Consent lasts only for the current page, including pauses and reconnects; reload clears it.
- Interim and final speech appear directly in the textarea, without duplicate previews. The dictation position follows the cursor after each manual edit. Tapping/clicking a new caret position or moving it with navigation keys redirects active dictation there. Visible words are retained; the old recognition session is invalidated before a fresh session starts. Selecting a text range does not redirect speech. There can be a short listening gap, and audio not yet returned by the old session may be lost.
- While dictation is enabled, typing, deleting, pasting, formatting, autocorrect and undo/redo keep it enabled. Every manual edit preserves the visible text, invalidates the old speech session, and continues insertion at the resulting selection end without replacing selected text. Late results cannot overwrite your edit, including changes to provisional words. Inputs without `beforeinput` follow the same rule.
- Undo/redo buttons and keyboard shortcuts with bounded, per-note history (up to 60 snapshots per direction, approximately 4 million UTF-16 units, or one larger snapshot). Interim revisions are grouped until finalization or a manual edit. Undo/redo invalidates old speech results and preserves whether dictation was enabled or paused; history is not persisted across reloads.
- Composition input invalidates the old speech session and waits until the keyboard commits its text before reconnecting. Browser-ended sessions reconnect automatically after a short delay. Stopping keeps the currently visible words; unfinished words may still need correction.
- A compact editor row contains Format and undo/redo. Format opens a floating panel without moving the text; it closes after choosing a format, pressing Escape or clicking outside. The Correct action appears in the same row only for selected text. No large blank toolbar areas are reserved.
- Autosaved draft and local archive using `localStorage` (only text, not audio recordings). Leaving the title field immediately saves the title and adds a new draft to the archive, without a Save button. Renaming updates the same note. Empty drafts do not create empty archive entries.
- Copy text, use Web Share when supported, export a Markdown file, import TXT/Markdown, and import/export a JSON archive.
- Install as a PWA; the service worker caches the app shell for offline access.
- Migrates storage from the previous single-file dictation editor (`diktat_single_file_v1`) when the browser origin is unchanged; also imports its JSON exports.

## Setup

Copy the repository contents into a folder named `dictatus` on any HTTPS web server. Open `/dictatus/`, then choose **Install app** in your browser if offered. There is no server-side application to run. For local development, serve this folder from `http://localhost` (for example, `python -m http.server 8000` in the repository directory).

**PWA installation and service workers do not work from a `file://` URL.** Chromium requires HTTPS or localhost for PWA installation. Web servers should serve `.webmanifest` as `application/manifest+json` or `application/json`.

## Speech recognition and privacy

The Web Speech API and microphone permission must be enabled in the browser. Dictatus does not use OS dictation feature, but corporate/browser policies may still disable speech recognition or microphone access.

Recognition latency depends on the browser engine, speech segmentation (often a pause before final text), the microphone, and possibly a remote service. Dictatus enables interim results and displays them as soon as the browser provides them; JavaScript cannot force the browser to finalize words sooner.

Local recognition depends on experimental browser support and the availability of language packs; `SpeechRecognition.available()` and `SpeechRecognition.install()` may be unavailable or blocked. On-device packs may need an initial download. If local recognition fails, Dictatus stops and requires explicit online permission before using the browser service. **Online mode permits remote audio processing; it does not prove that a server is used.** Offline mode requires `processLocally = true`, checked on the actual recognition instance.

The installed PWA shell and text-editing features work offline after the first successful cache installation. Dictation works offline **only when actual on-device recognition is supported and the language pack is installed**. Browser storage is bound to the page's origin and can be deleted by browser settings or data clearing. Export JSON backups regularly.

## Fast dictation controls

The main button pauses immediately and keeps the currently visible text. Resume at the textarea cursor with the button or **Ctrl/Cmd + Shift + Space**. The shortcut is ignored during keyboard composition and key repeat. The recording button stays within reach when scrolling the editor panel. Pause may discard audio for which the browser has not delivered text yet; review unfinished words.

There are two user-controlled states: dictation enabled and paused. While enabled, editing anywhere keeps it enabled: after 250 ms without another edit, recognition reconnects automatically at the resulting cursor. IME composition waits for commit. The status shows Editing or Reconnecting during this transition; the button remains Pause dictation. While paused, typing, cursor movement, formatting and undo/redo never restart recognition. Choose Resume dictation explicitly. Browser-ended sessions also reconnect automatically while enabled. Microphone/service errors can stop recognition and display the reason.

Reconnecting is not uninterrupted audio capture: speech not yet returned by the old session can be lost. Visible words are preserved, even if provisional. Wait for Listening before speaking after an edit; the browser API does not provide reliable audio buffering across sessions.

### Android recognition

Android browsers use short recognition sessions with interim results and automatic reconnection after each completed phrase. This avoids the Android continuous-recognition bridge promoting growing partial transcripts to separate final results. Only one terminal result is accepted per short session; repeated words inside a phrase or in a new session are retained. Desktop recognition remains continuous. Android detection also covers touch devices reporting a Linux desktop platform.

There can be a short listening gap at reconnection. The regression tests simulate the Android bridge behavior; real microphone behavior still requires device testing. This change does not remove duplicates already stored in a note.

## Keyboard shortcuts

Open **Keyboard shortcuts** in the app for the complete action list. Button tooltips and `aria-keyshortcuts` expose the same bindings.

| Action | Shortcut |
| --- | --- |
| Hold to talk (release to finish) | Alt + Shift + Space |
| Pause / resume at cursor | Ctrl/Cmd + Shift + Space |
| New note | Alt + Shift + N |
| Show / hide archive | Alt + Shift + B |
| Show formatting | Alt + Shift + M |
| Add correction from selected text | Alt + Shift + L |
| Copy / share text | Alt + Shift + C / H |
| Download Markdown / export archive | Alt + Shift + E / A |
| Import / search archive | Alt + Shift + I / F |
| Toggle speech settings / save them | Alt + Shift + D / W |
| Toggle shortcut help | Alt + Shift + K |
| Undo / redo editor change | Alt + Shift + U / R |
| Undo / redo while editing | Ctrl/Cmd + Z / Ctrl/Cmd + Shift + Z; Ctrl + Y |
| H1 / H2 / bold / italic / strike | Ctrl/Cmd + Shift + 1 / 2 / 3 / 4 / 5 |
| Code / bullet list / numbered list / quote / link | Ctrl/Cmd + Shift + 6 / 7 / 8 / 9 / 0 |
| Open / delete a focused archive note | Enter / Delete (deletion asks for confirmation) |

Use the top number row for Markdown shortcuts. Native keyboard navigation (Tab, Enter, Space, arrows) operates all settings and controls. App shortcuts ignore keyboard composition, repeat and AltGraph; Ctrl/Cmd+Z remains native in dictionary inputs. Disabled actions remain disabled when invoked by shortcut. Browser/OS shortcuts may take precedence; all actions remain available through visible controls.

## Speech commands and dictionary

Open **Words & dictation settings** below the editor actions. Save punctuation choices with **Save punctuation settings**. Words and corrections save automatically when added or removed. Saving during dictation keeps it enabled and automatically starts a fresh recognition session with the updated configuration. New corrections apply immediately to incoming interim and final text. Saving while paused does not start recording.

Command conversion waits for a final recognition result: provisional text shows the spoken command words, then the confirmed result inserts the punctuation or line break. This prevents a tentative command from flashing as punctuation and disappearing when the browser revises it. Browser-generated punctuation and other interim text can still change before confirmation; the app cannot guarantee recognition accuracy. Confirmed punctuation is kept when subsequent interim words are revised or withdrawn. Pausing before confirmation keeps the visible, unconverted words.

- **Explicit (default):** say “punctuation comma” / “Satzzeichen Komma”. The ordinary words “period” / “Punkt” remain literal. Available punctuation: period / Punkt, comma / Komma, question mark / Fragezeichen, exclamation mark / Ausrufezeichen, colon / Doppelpunkt, semicolon / Semikolon. “Full stop” also works in English.
- **Short:** the same punctuation names work without the prefix. This can replace ordinary words; use Explicit or Off when discussing punctuation literally.
- In either command mode, “new line” / “neue Zeile” creates a newline; “new paragraph” / “neuer Absatz” creates a blank line. Speak a complete command together. Commands split across finalized recognition results are not combined.
- **Off:** no app-level command conversion. The browser may still produce its own punctuation.
- **Automatic punctuation:** opt-in, enabled only if the browser exposes `unspokenPunctuation`. The capability status reports when unavailable. Accuracy depends on the engine.
- **Suggest the correct spelling:** enter the correct spelling, such as `quinoa` (not a pronunciation or phonetic transcription), and choose **Add word**. Each saved word has a remove button. Up to 100 entries. The app sends recognition hints using `SpeechRecognitionPhrase` with a moderate boost when supported. Hints are not training and may be sent to a remote recognition provider. A rejected hint feature retries without hints.
- **Replace misrecognized text:** enter `keen wah` under **What appears incorrectly?** and `quinoa` under **What should appear instead?**, then choose **Add correction**. No special notation is needed. Up to 100 corrections. Matching is case-insensitive and respects Unicode word boundaries. Longest matches win; replacements do not cascade. Example: `keen wah => quinoa`. Corrections affect new speech only, after command processing, never manually edited text.

Speech settings persist locally under `dictatus_speech_settings_v1`. JSON archive exports include them; import asks whether to replace current settings. Archives without settings remain compatible. No external scripts, dictionaries or services are added by these features.

## Data formats

`Export archive` writes a `dictatus-YYYY-MM-DD.json` file containing notes and any unfiled draft. `Import` merges JSON notes by ID (existing IDs are skipped). Legacy exports (`app: "diktat-single-file"`, version 1) are also accepted. TXT and Markdown imports create a new archived note.

## Development

The entire editor implementation is embedded in `index.html` for straightforward inspection and maintenance. `manifest.webmanifest`, `service-worker.js` and PNG icons are only for PWA integration. No third-party JavaScript or CSS is loaded.

## Tests

The app has no runtime dependencies. Browser tests require Node.js and Playwright:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node --test tests/recognition.test.cjs
```

`CHROMIUM_PATH` may point to an existing Chromium executable. Tests run the actual inline application in Chromium with simulated speech events. They cover live insertion, concurrent editing, selection/scroll preservation, Markdown, undo/redo, composition, reconnects, late events, and saved notes. Real microphone recognition, provider latency, OS keyboard composition and PWA installation still need device testing.

## License

MIT (see LICENSE).


### Spelling and corrections from the editor

The textarea requests native spellchecking, with its `lang` set to the same language as speech recognition rather than inheriting the English interface language. Recognition updates remain inline. Checking of newly dictated words and sentences, available dictionaries and spelling underlines are controlled by the browser and keyboard settings. There is no standard API to force a spellcheck pass or read the browser's spelling markers. Dictatus does not simulate typing, replace the editor or move focus after speech results to try to force a check.

Select an incorrectly written word or short phrase to reveal **Correct** in the editor row, then choose it (Alt + Shift + L). The correction form opens with the actual selected text already entered. Type the correct spelling and choose **Add correction** or press Enter. This stores a rule for future dictated text; it does not automatically replace existing occurrences or add a word to the browser's own dictionary. You can use this action on any selected text, including a word underlined by the browser. No external spellchecking service is added.

The Show / Hide archive button below New collapses the sidebar and gives its width to the editor. This preference persists locally. On narrow screens, opening the archive focuses its search field; the close button returns focus to the toggle. The search shortcut also opens a collapsed archive.


### Hold to talk and recording status

A single dictation button supports both gestures: **tap to start/pause**, or **hold for at least 300 ms to talk until release**. Speak when the status says **Listening**. Releasing a hold finishes the phrase without starting a continuous session. While continuous dictation is running, the button pauses it; holding does not take over that session. Short Space/Enter presses on the focused button toggle; holding them uses hold-to-talk. **Ctrl/Cmd + Shift + Space** toggles, **Alt + Shift + Space** holds immediately without the gesture delay. Browser or operating-system shortcuts may take precedence.

On release the app requests `SpeechRecognition.stop()` and shows **Finishing** while accepting the last result. The browser attempts to finalize captured audio; delivery is not guaranteed. If it does not finish within five seconds, the visible text is retained and a timeout is shown. Editing or moving the editor caret while finishing invalidates remaining results to protect your changes. A release during preparation cancels that pending start. Android sessions reconnect only while the hold is still active. Pointer cancellation or lost capture ends a pointer hold; switching away from the window or hiding the app cancels a hold and keeps visible text.

Status meanings: **Connecting** = not yet listening; **Listening** = recognition is active; **Processing / Finishing** = waiting for results; **Paused** = recording is off. An amber indicator marks preparation/processing, a pulsing red indicator marks listening, and errors are shown explicitly. The interface does not show a simulated audio level.

### Local text actions

The top text menu offers **Fix text**, **Rewrite**, **Summarize**, and **Translate** only when the corresponding native browser API reports support for the current input language (and at least one offered translation target). Missing APIs, rejected availability checks, and unavailable language configurations remain hidden. Downloadable/downloading models count as supported, but model creation/download starts only after **Download & generate preview** is pressed. No cloud fallback or third-party model service is used.

Actions use the selected text, or the entire note when nothing is selected, and pause dictation first. The dialog lets you verify the source language and choose a translation target. Rewrite preserves tone and length by default; Summarize produces short Markdown key points. Original and preview are plain text. **Apply** replaces only the captured range and creates an undoable edit; **Cancel** or Escape discards the result. A changed document invalidates the preview, including edits that were subsequently undone. Closing the dialog aborts pending work and releases the model session. Errors leave the note unchanged.

Shortcuts: **Alt + Shift + P** (Fix text), **J** (Rewrite), **Q** (Summarize), **T** (Translate), each with Alt + Shift. Unavailable actions cannot be invoked through shortcuts. While the dialog is open, app-wide shortcuts are suspended; its controls use native Tab/Enter/Space navigation and Escape closes it.

Actual support depends on browser version, API rollout, device hardware, policy, model availability, and language. A downloadable model may require internet access once; processing itself uses the native local API. The app does not enable browser flags or enroll an origin trial automatically. API presence and availability are checked at runtime rather than inferred from the user agent. Tests simulate API responses and lifecycle behavior; they do not establish real-model correction quality or performance.

API references: [Proofreader](https://developer.chrome.com/docs/ai/proofreader-api), [Rewriter](https://developer.chrome.com/docs/ai/rewriter-api), [Summarizer](https://developer.chrome.com/docs/ai/summarizer-api), [Translator](https://developer.chrome.com/docs/ai/translator-api).
