'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()] }));
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH }); });
after(async () => { await browser?.close(); });
async function setup(t, text = 'Hello world!', position = 6, device = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US', ...device });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(() => {
    window.sessions = [];
    window.SpeechRecognition = class {
      constructor() { window.sessions.push(this); }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
      emit(parts) {
        this.onresult?.({ results: parts.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
      }
    };
  });
  await page.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: fs.readFileSync(process.env.APP_HTML || path.join(__dirname, '../index.html'), 'utf8') }));
  await page.goto('http://localhost/');
  await page.locator('#editor').fill(text);
  await page.locator('#editor').evaluate((e, p) => e.setSelectionRange(p, p), position);
  await page.locator('#record-button').click();
  await page.locator('#allow-online').click();
  await page.locator('#record-button').click();
  await page.waitForFunction(() => window.sessions.some(s => s.onresult));
  return page;
}
async function emit(page, parts) { await page.evaluate(parts => window.sessions.at(-1).emit(parts), parts); }
async function value(page) { return page.locator('#editor').inputValue(); }

test('interim and final text appear only in the editor at the starting caret', async t => {
  const page = await setup(t);
  await emit(page, [['wonder', false]]);
  assert.equal(await value(page), 'Hello wonder world!');
  await emit(page, [['wonderful', true], ['day', false]]);
  assert.equal(await value(page), 'Hello wonderful day world!');
  await emit(page, [['wonderful', true], ['day', true]]);
  await emit(page, [['wonderful', true], ['day', true]]);
  assert.equal(await value(page), 'Hello wonderful day world!');
  assert.equal(await page.locator('#interim').count(), 0);
});

test('editing earlier text keeps visible words and continues at the editing caret', async t => {
  const page = await setup(t);
  await emit(page, [['wonder', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.keyboard.insertText('Good morning');
  await emit(page, [['late words', true]]);
  assert.equal(await value(page), 'Good morning wonder world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['everyone', true]]);
  assert.equal(await value(page), 'Good morning everyone wonder world!');
});

test('editing provisional text keeps dictation enabled and ignores late results', async t => {
  const page = await setup(t);
  await emit(page, [['wonder', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(6, 12));
  await page.keyboard.insertText('lovely');
  await emit(page, [['wonderful', true]]);
  assert.equal(await value(page), 'Hello lovely world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
});

test('speech settings request continuous interim results', async t => {
  const page = await setup(t);
  assert.deepEqual(await page.evaluate(() => [sessions.at(-1).continuous, sessions.at(-1).interimResults]), [true, true]);
});

test('editing later text invalidates old speech and resumes after the edit', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(e.value.length - 6, e.value.length));
  await page.keyboard.insertText('planet!');
  await emit(page, [['beautiful', true]]);
  assert.equal(await value(page), 'Hello nice planet!');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['Next', true]]);
  assert.equal(await value(page), 'Hello nice planet! Next');
});

test('formatting and undo redo retain recording intent and reject previous speech', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.locator('#format-toggle').click();
  await page.locator('[data-format="bold"]').click();
  await emit(page, [['beautiful', true]]);
  assert.equal(await value(page), '**Hello** nice world!');
  await page.locator('#editor').press('Control+z');
  assert.equal(await value(page), 'Hello nice world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
  await page.locator('#editor').press('Control+Shift+z');
  assert.equal(await value(page), '**Hello** nice world!');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['next', true]]);
  assert.equal(await value(page), '**Hello next ** nice world!');
});

test('composition rejects old speech and resumes only after the committed edit', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').evaluate(e => {
    e.focus(); e.setSelectionRange(0, 5);
    e.dispatchEvent(new CompositionEvent('compositionstart'));
    e.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertCompositionText', data: 'Hi' }));
    e.setRangeText('Hi', 0, 5, 'end');
    e.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }));
  });
  await emit(page, [['beautiful', true]]);
  await page.waitForTimeout(350);
  assert.equal(await value(page), 'Hi nice world!');
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 1);
  await page.locator('#editor').evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend')));
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['there', true]]);
  assert.equal(await value(page), 'Hi there nice world!');
});

test('automatic reconnect preserves the anchor and rejects results from the old session', async t => {
  const page = await setup(t, 'Hello', 5);
  await emit(page, [['there', true]]);
  await page.evaluate(() => sessions.at(-1).onend());
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 0));
  await page.evaluate(() => sessions[0].emit([['duplicate', true]]));
  await emit(page, [['friend', true]]);
  assert.equal(await value(page), 'Hello there friend');
  assert.equal(await page.locator('#editor').evaluate(e => e.selectionStart), 0);
});

test('stop retains the visible hypothesis and late results cannot alter it', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#record-button').click();
  await emit(page, [['different', true]]);
  assert.equal(await value(page), 'Hello nice world!');
});

test('deleting repeated characters continues at the resulting caret', async t => {
  const page = await setup(t, 'aaaa END', 4);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(1, 1));
  await page.keyboard.press('Backspace');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['word', true]]);
  assert.equal(await value(page), 'word aaa END');
});

test('long dictation does not scroll an older correction out of view', async t => {
  const text = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n');
  const page = await setup(t, text, text.length);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => { e.setSelectionRange(0, 4); e.scrollTop = 0; });
  for (let i = 0; i < 30; i++) {
    await emit(page, Array.from({ length: i + 1 }, (_, j) => [`phrase ${j}`, true]));
  }
  assert.equal(await page.locator('#editor').evaluate(e => e.scrollTop), 0);
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [0, 4]);
  assert.ok((await value(page)).endsWith('phrase 29'));
});

test('punctuation attaches to a finalized phrase inserted before existing text', async t => {
  const page = await setup(t);
  await emit(page, [['nice', true]]);
  await emit(page, [['nice', true], [',', true]]);
  assert.equal(await value(page), 'Hello nice, world!');
});

test('withdrawn hypotheses are removed without touching surrounding text', async t => {
  const page = await setup(t);
  await emit(page, [['maybe', false]]);
  await emit(page, []);
  assert.equal(await value(page), 'Hello world!');
});

test('history is reset when opening a new note and archive text survives reload', async t => {
  const page = await setup(t);
  await emit(page, [['nice', true]]);
  await page.locator('#record-button').click();
  await page.reload();
  assert.equal(await value(page), 'Hello nice world!');
  await page.locator('#new-button').click();
  await page.locator('#editor').press('Control+z');
  assert.equal(await value(page), '');
  await page.locator('.archive-open').first().click();
  assert.equal(await value(page), 'Hello nice world!');
});

test('mobile viewport stays within the screen and autosave keeps inline speech', async t => {
  const page = await setup(t);
  await page.setViewportSize({ width: 390, height: 844 });
  await emit(page, [['mobile words', false]]);
  await page.locator('#editor').focus();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('dictatus_v1'))?.draft.text.includes('mobile words'));
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
});

test('non-cancelable native undo uses app history and invalidates speech', async t => {
  const page = await setup(t);
  await emit(page, [['nice', true]]);
  await page.locator('#editor').evaluate(e => {
    e.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: false }));
    e.value = 'native stale state';
    e.dispatchEvent(new InputEvent('input', { inputType: 'historyUndo' }));
  });
  assert.equal(await value(page), 'Hello world!');
  await emit(page, [['late', true]]);
  assert.equal(await value(page), 'Hello world!');
});

test('a second session starts at a newly chosen caret', async t => {
  const page = await setup(t);
  await emit(page, [['nice', true]]);
  await page.locator('#record-button').click();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 0));
  await page.locator('#record-button').click();
  await emit(page, [['Start', true]]);
  assert.equal(await value(page), 'Start Hello nice world!');
});

test('starting with selected text inserts after it without expanding the selection', async t => {
  const page = await setup(t);
  await page.locator('#record-button').click();
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.locator('#record-button').click();
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [0, 5], 'before interim');
  await emit(page, [['nice', false]]);
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [0, 5], 'after interim');
  await emit(page, [['lovely', true]]);
  assert.equal(await value(page), 'Hello lovely world!');
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [0, 5]);
});

test('edits without beforeinput are preserved and continue automatically', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').evaluate(e => {
    e.value = 'Changed ' + e.value;
    e.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText' }));
  });
  await emit(page, [['different', true]]);
  assert.equal(await value(page), 'Changed Hello nice world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
});

async function settings(page, { commands = 'explicit', words = '', replacements = '', punctuation = false } = {}) {
  if (await page.locator('#record-button').getAttribute('aria-pressed') === 'true') await page.locator('#record-button').click();
  await page.locator('#speech-settings').evaluate(e => e.open = true);
  await page.locator('#command-mode').selectOption(commands);
  await page.locator('#custom-words').evaluate((e, value) => e.value = value, words);
  await page.locator('#custom-replacements').evaluate((e, value) => e.value = value, replacements);
  await page.locator('#auto-punctuation').setChecked(punctuation);
  await page.locator('#command-mode').dispatchEvent('change');
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(e.value.length, e.value.length));
  await page.locator('#record-button').click();
}

test('explicit commands preserve literal words and insert punctuation and paragraphs', async t => {
  const page = await setup(t, '', 0);
  await settings(page);
  await emit(page, [['Ein wichtiger Punkt Satzzeichen Komma wirklich Satzzeichen Punkt neuer Absatz Weiter', true]]);
  assert.equal(await value(page), 'Ein wichtiger Punkt, wirklich.\n\nWeiter');
});

test('simple commands and newlines remain formatted across speech events', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { commands: 'simple' });
  await emit(page, [['Hallo Komma Welt Punkt neue Zeile', true]]);
  await emit(page, [['Hallo Komma Welt Punkt neue Zeile', true], ['Weiter', true]]);
  assert.equal(await value(page), 'Hallo, Welt.\nWeiter');
});

test('dictionary replacements are literal, case insensitive, whole phrase and non-cascading', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { commands: 'off', replacements: 'foo => bar\nbar => Baz\nkeen wah => quinoa' });
  await emit(page, [['FOO bar food keen wah', true]]);
  assert.equal(await value(page), 'bar Baz food quinoa');
});

test('speech settings persist across reloads and leave manually typed text unchanged', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { replacements: 'foo => Fachwort', words: 'Acoustics\nquinoa' });
  await page.locator('#record-button').click();
  await page.reload();
  await page.locator('#speech-settings').evaluate(e => e.open = true);
  assert.equal(await page.locator('#custom-words').inputValue(), 'Acoustics\nquinoa');
  await page.locator('#editor').fill('foo');
  assert.equal(await value(page), 'foo');
});

test('shortcut pauses and resumes at the editing caret without accepting late events', async t => {
  const page = await setup(t, 'Hello', 5);
  await emit(page, [['friend', false]]);
  await page.keyboard.press('Control+Shift+Space');
  await emit(page, [['late', true]]);
  assert.equal(await value(page), 'Hello friend');
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 0));
  await page.keyboard.press('Control+Shift+Space');
  await emit(page, [['Start', true]]);
  assert.equal(await value(page), 'Start Hello friend');
});

test('invalid replacement settings are rejected without losing previous settings', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { replacements: 'foo => Bar' });
  await page.locator('#record-button').click();
  await page.locator('#custom-replacements').evaluate(e => e.value = 'invalid line');
  await page.locator('#command-mode').dispatchEvent('change');
  assert.match(await page.locator('#settings-status').textContent(), /line 1/i);
  await page.reload();
  assert.equal(await page.locator('#custom-replacements').inputValue(), 'foo => Bar');
});

test('supported recognition receives word hints and automatic punctuation', async t => {
  const page = await setup(t, '', 0);
  await page.evaluate(() => {
    SpeechRecognition.prototype.phrases = [];
    SpeechRecognition.prototype.unspokenPunctuation = false;
    window.SpeechRecognitionPhrase = class { constructor(phrase, boost) { this.phrase = phrase; this.boost = boost; } };
  });
  await settings(page, { words: 'quinoa', replacements: 'keen wah => quinoa', punctuation: true });
  assert.deepEqual(await page.evaluate(() => sessions.at(-1).phrases.map(p => [p.phrase, p.boost])), [['quinoa', 3]]);
  assert.equal(await page.evaluate(() => sessions.at(-1).unspokenPunctuation), true);
});

test('unsupported optional features report fallback while corrections still work', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { words: 'quinoa', replacements: 'keen wah => quinoa', punctuation: true });
  assert.match(await page.locator('#speech-capabilities').textContent(), /Word hints unavailable/);
  assert.match(await page.locator('#speech-capabilities').textContent(), /Automatic punctuation unavailable/);
  await emit(page, [['keen wah', true]]);
  assert.equal(await value(page), 'quinoa');
});

test('rejected hints restart once without hints and reject stale results', async t => {
  const page = await setup(t, '', 0);
  await page.evaluate(() => {
    SpeechRecognition.prototype.phrases = [];
    window.SpeechRecognitionPhrase = class { constructor(phrase) { this.phrase = phrase; } };
  });
  await settings(page, { words: 'quinoa', replacements: 'keen wah => quinoa' });
  const count = await page.evaluate(() => sessions.length);
  await page.evaluate(() => sessions.at(-1).onerror({ error: 'phrases-not-supported' }));
  await page.waitForFunction(count => sessions.length > count && sessions.at(-1).onresult, count);
  assert.deepEqual(await page.evaluate(() => sessions.at(-1).phrases), []);
  await emit(page, [['keen wah', true]]);
  assert.equal(await value(page), 'quinoa');
});

test('archive export and import round-trip settings with explicit replacement consent', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { words: 'quinoa', replacements: 'keen wah => quinoa' });
  await page.locator('#record-button').click();
  const pending = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const download = await pending;
  const archive = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(archive.speechSettings.words, 'quinoa');
  archive.speechSettings.words = 'Orion';
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#file-import').setInputFiles({ name: 'archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
  await page.waitForFunction(() => document.getElementById('custom-words').value === 'Orion');
  await page.reload();
  assert.equal(await page.locator('#custom-words').inputValue(), 'Orion');
});

test('replacement metacharacters and replacement dollar signs stay literal', async t => {
  const page = await setup(t, '', 0);
  await settings(page, { commands: 'off', replacements: 'c++ => C plus plus\nprice => $&\nS => small' });
  await emit(page, [['c++ price ſ', true]]);
  assert.equal(await value(page), 'C plus plus $& small');
});

test('keyboard actions save, create and find notes without changing existing editor shortcuts', async t => {
  const page = await setup(t, 'Keyboard note', 13);
  await page.keyboard.press('Control+Shift+Space');
  assert.equal(await page.locator('.archive-item').count(), 1);
  await page.keyboard.press('Alt+Shift+n');
  assert.equal(await value(page), '');
  await page.keyboard.press('Alt+Shift+f');
  assert.equal(await page.locator('#archive-search').evaluate(e => e === document.activeElement), true);
});

test('keyboard markdown formats the selection and undo restores it', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.keyboard.press('Control+Shift+Space');
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.keyboard.press('Control+Shift+Digit3');
  assert.equal(await value(page), '**Hello** world');
  await page.keyboard.press('Control+z');
  assert.equal(await value(page), 'Hello world');
});

test('every app action shortcut routes to its accessible control', async t => {
  const page = await setup(t, 'Routing', 7);
  await page.keyboard.press('Control+Shift+Space');
  const bindings = [['b','archive-toggle'],['m','format-toggle'],['l','selection-correction'],['c','copy-button'],['h','share-button'],['e','markdown-export-button'],['a','export-button'],['i','import-button'],['n','new-button'],['d','settings-toggle'],['k','shortcuts-toggle'],['u','undo-button'],['r','redo-button']];
  await page.evaluate(bindings => {
    window.shortcutClicks = [];
    for (const [, id] of bindings) {
      const button = document.getElementById(id);
      button.disabled = false;
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopImmediatePropagation();
        window.shortcutClicks.push(id);
      }, { capture: true });
    }
  }, bindings);
  for (const [key, id] of bindings) {
    await page.keyboard.press(`Alt+Shift+${key}`);
    assert.equal(await page.evaluate(() => shortcutClicks.at(-1)), id);
    assert.match(await page.locator(`#${id}`).getAttribute('aria-keyshortcuts'), /Alt\+Shift/);
  }
});

test('all ten Markdown shortcuts format the selected text', async t => {
  const page = await setup(t, '', 0);
  await page.keyboard.press('Control+Shift+Space');
  const expected = ['# word','## word','**word**','*word*','~~word~~','`word`','- word','1. word','> word','[word](https://)'];
  for (let i = 0; i < expected.length; i++) {
    await page.locator('#editor').fill('word');
    await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 4));
    await page.keyboard.press(`Control+Shift+Digit${(i + 1) % 10}`);
    assert.equal(await value(page), expected[i]);
  }
});

test('import and export shortcuts operate the file chooser and download', async t => {
  const page = await setup(t, 'Export me', 9);
  await page.keyboard.press('Control+Shift+Space');
  const pendingDownload = page.waitForEvent('download');
  await page.keyboard.press('Alt+Shift+e');
  assert.equal(fs.readFileSync(await (await pendingDownload).path(), 'utf8'), 'Export me');
  const pendingChooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Alt+Shift+i');
  await (await pendingChooser).setFiles({ name: 'note.md', mimeType: 'text/markdown', buffer: Buffer.from('Imported by keyboard') });
  await page.waitForFunction(() => document.getElementById('editor').value === 'Imported by keyboard');
});

test('archive notes open and delete with keyboard and confirmation', async t => {
  const page = await setup(t, 'Archived', 8);
  await page.keyboard.press('Control+Shift+Space');
  await page.keyboard.press('Alt+Shift+n');
  await page.locator('.archive-open').first().focus();
  await page.keyboard.press('Enter');
  assert.equal(await value(page), 'Archived');
  await page.locator('.archive-open').first().focus();
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Delete');
  assert.equal(await page.locator('.archive-item').count(), 0);
});

test('shortcuts ignore composition and key repeat and retain native typing', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#editor').evaluate(e => {
    e.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, isComposing: true, bubbles: true }));
    e.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, repeat: true, bubbles: true }));
  });
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Control+Shift+Space');
  await page.locator('#editor').fill('Ordinary typing');
  assert.equal(await value(page), 'Ordinary typing');
});

test('Android growing hypotheses replace each other instead of accumulating', async t => {
  const page = await setup(t, '', 0, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36' });
  await page.evaluate(() => {
    const session = sessions.at(-1);
    const accumulated = [];
    for (const transcript of ['so jetzt', 'so jetzt probieren', 'so jetzt probieren wir es']) {
      // Android's continuous bridge can promote partials to separate finals.
      if (session.continuous) {
        accumulated.push([transcript, true]);
        session.emit(accumulated);
      } else session.emit([[transcript, false]]);
    }
    session.emit(session.continuous ? [...accumulated, ['so jetzt probieren wir es', true]] : [['so jetzt probieren wir es', true]]);
  });
  assert.equal(await value(page), 'so jetzt probieren wir es');
});

test('Android sessions preserve intentional repetitions and ignore extra terminal callbacks', async t => {
  const page = await setup(t, '', 0, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36' });
  await emit(page, [['ja ja', true]]);
  await emit(page, [['ja ja', true], ['ja ja', true]]);
  assert.equal(await value(page), 'ja ja');
  await page.evaluate(() => sessions.at(-1).onend());
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['ja ja', true]]);
  assert.equal(await value(page), 'ja ja ja ja');
});

test('dictionary forms add, persist and remove entries without special notation', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.locator('#speech-settings').evaluate(e => e.open = true);
  await page.locator('#word-entry').fill('quinoa');
  await page.locator('#word-entry').press('Enter');
  assert.equal(await page.locator('#word-list .remove-entry').count(), 1);
  await page.locator('#heard-entry').fill('keen wah');
  await page.locator('#replacement-entry').fill('quinoa');
  await page.locator('#add-correction').click();
  assert.match(await page.locator('#correction-list').textContent(), /keen wah → quinoa/);
  await page.reload();
  await page.locator('#speech-settings').evaluate(e => e.open = true);
  assert.equal(await page.locator('#word-list .remove-entry').count(), 1);
  await page.locator('#word-list .remove-entry').click();
  await page.locator('#correction-list .remove-entry').focus();
  await page.keyboard.press('Enter');
  await page.reload();
  assert.equal(await page.locator('#word-list .remove-entry').count(), 0);
  assert.equal(await page.locator('#correction-list .remove-entry').count(), 0);
});

test('dictionary form rejects duplicate words and retains invalid entries for correction', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.locator('#speech-settings').evaluate(e => e.open = true);
  await page.locator('#word-entry').fill('quinoa');
  await page.locator('#add-word').click();
  await page.locator('#word-entry').fill('QUINOA');
  await page.locator('#add-word').click();
  assert.match(await page.locator('#settings-status').textContent(), /already/);
  assert.equal(await page.locator('#word-list .remove-entry').count(), 1);
  await page.locator('#heard-entry').fill('wrong => notation');
  await page.locator('#replacement-entry').fill('quinoa');
  await page.locator('#add-correction').click();
  assert.match(await page.locator('#settings-status').textContent(), /no arrow/);
  assert.equal(await page.locator('#heard-entry').inputValue(), 'wrong => notation');
});

test('expanded settings remain usable across phone, tablet and desktop widths', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.locator('#speech-settings').evaluate(e => e.open = true);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}`);
    const font = await page.locator('#word-entry').evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(font >= 16);
    if (process.env.SCREENSHOT_PATH && [390, 1440].includes(width)) {
      await page.screenshot({ path: process.env.SCREENSHOT_PATH.replace('.png', `-${width}.png`), fullPage: true });
    }
  }
});

test('touch devices with Linux desktop identification also use short sessions', async t => {
  const page = await setup(t, '', 0, { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 Safari/537.36', hasTouch: true });
  assert.equal(await page.evaluate(() => sessions.at(-1).continuous), false);
});


test('Android tap redirects dictation and rejects old-session callbacks', async t => {
  const page = await setup(t, 'Hello world', 11, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true });
  await emit(page, [['first', false]]);
  await page.locator('#editor').evaluate(e => {
    window.oldSession = sessions.at(-1);
    e.focus();
    e.setSelectionRange(6, 6);
    e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.evaluate(() => { oldSession.emit([['late result', true]]); oldSession.onend(); });
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['new', true]]);
  assert.equal(await value(page), 'Hello new world first');
  await page.evaluate(() => sessions.at(-1).onend());
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 3);
  await emit(page, [['again', true]]);
  assert.equal(await value(page), 'Hello new again world first');
});

test('keyboard caret navigation redirects speech without reacting to programmatic updates', async t => {
  const page = await setup(t, 'Hello world', 11);
  await emit(page, [['first', true]]);
  await page.locator('#editor').focus();
  await page.keyboard.press('Home');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['New', true]]);
  assert.equal(await value(page), 'New Hello world first');
  await emit(page, [['New', true], ['start', true]]);
  assert.equal(await value(page), 'New start Hello world first');
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 2);
});

test('punctuation commands wait for final confirmation and survive subsequent interim withdrawal', async t => {
  const page = await setup(t, '', 0);
  await emit(page, [['Hello punctuation comma', false]]);
  assert.equal(await value(page), 'Hello punctuation comma');
  await emit(page, [['Hello', false]]);
  assert.equal(await value(page), 'Hello');
  await emit(page, [['Hello punctuation comma', true], ['world', false]]);
  assert.equal(await value(page), 'Hello, world');
  await emit(page, [['Hello punctuation comma', true]]);
  assert.equal(await value(page), 'Hello,');
  await emit(page, [['Hello punctuation comma', true], ['again punctuation period', true]]);
  assert.equal(await value(page), 'Hello, again.');
});


test('a touchscreen tap places the next phrase at the actual browser caret', async t => {
  const page = await setup(t, 'Hello world', 11, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  await page.locator('#editor').scrollIntoViewIfNeeded();
  const box = await page.locator('#editor').boundingBox();
  await page.touchscreen.tap(box.x + 18, box.y + 27);
  const anchor = await page.locator('#editor').evaluate(e => e.selectionEnd);
  assert.ok(anchor < 11);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['New', true]]);
  const before = 'Hello world'.slice(0, anchor);
  const after = 'Hello world'.slice(anchor);
  assert.equal(await value(page), before + (before && !/\s$/.test(before) ? ' ' : '') + 'New' + (after && !/^\s/.test(after) ? ' ' : '') + after);
});

test('rapid caret changes during reconnect use the latest position and pause cancels restart', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.evaluate(() => sessions.at(-1).onend());
  await page.locator('#editor').evaluate(e => {
    e.focus();
    for (const position of [0, 3, 6]) {
      e.setSelectionRange(position, position);
      e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['new', true]]);
  assert.equal(await value(page), 'Hello new world');
  await page.locator('#editor').evaluate(e => {
    e.setSelectionRange(0, 0);
    e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('record-button').click();
  });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 2);
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});

test('selecting text with a pointer does not relocate the live phrase', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.locator('#editor').evaluate(e => {
    e.focus(); e.setSelectionRange(0, 5);
    e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await emit(page, [['new', true]]);
  assert.equal(await value(page), 'Hello world new');
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [0, 5]);
});


test('dragging a selection does not redirect at its transient collapsed start', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.locator('#editor').evaluate(e => {
    e.focus();
    e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    e.setSelectionRange(0, 0);
  });
  await page.locator('#editor').evaluate(e => {
    e.setSelectionRange(0, 5);
    e.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await emit(page, [['new', true]]);
  assert.equal(await value(page), 'Hello world new');
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [0, 5]);
});


test('Android dictate, tap, type, dictate works without pressing resume', async t => {
  const page = await setup(t, 'Hello world', 11, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true });
  await emit(page, [['first', false]]);
  await page.locator('#editor').evaluate(e => {
    e.focus(); e.setSelectionRange(6, 6);
    e.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.keyboard.type('typed ', { delay: 20 });
  await page.evaluate(() => {
    sessions[0].emit([['stale final', true]]);
    sessions[0].onerror({ error: 'not-allowed' });
    sessions[0].onend();
  });
  assert.equal(await value(page), 'Hello typed world first');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['spoken', true]]);
  assert.equal(await value(page), 'Hello typed spoken world first');
});

test('manual pause remains paused through typing, paste, navigation and undo', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.locator('#record-button').click();
  await page.locator('#editor').focus();
  await page.keyboard.press('Home');
  await page.keyboard.insertText('Typed ');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(400);
  assert.equal(await value(page), 'Typed Hello world');
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 1);
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
  assert.match(await page.locator('#record-button').textContent(), /Resume dictation/);
});

test('typing at the live boundary protects the edit and subsequent final punctuation', async t => {
  const page = await setup(t, '', 0);
  await emit(page, [['Hello', false]]);
  await page.locator('#editor').focus();
  await page.keyboard.insertText(' there');
  await emit(page, [['old phrase', true]]);
  assert.equal(await value(page), 'Hello there');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['punctuation comma', true]]);
  await emit(page, [['punctuation comma', true], ['friend', false]]);
  assert.equal(await value(page), 'Hello there, friend');
});

test('composition followed by manual pause cannot restart dictation', async t => {
  const page = await setup(t);
  await page.locator('#editor').evaluate(e => e.dispatchEvent(new CompositionEvent('compositionstart')));
  await page.locator('#record-button').click();
  await page.locator('#editor').evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend')));
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 1);
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});


test('title blur saves a new note and later renames it without a Save button', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#save-button').count(), 0);
  await page.locator('#note-title').fill('First title');
  await page.locator('#editor').focus();
  assert.equal(await page.locator('.archive-item').count(), 1);
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dictatus_v1')));
  assert.equal(saved.notes[0].title, 'First title');
  const id = saved.notes[0].id;
  await page.locator('#note-title').fill('Renamed');
  await page.locator('#editor').focus();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dictatus_v1')));
  assert.equal(saved.notes.length, 1);
  assert.equal(saved.notes[0].id, id);
  assert.equal(saved.notes[0].title, 'Renamed');
  await page.locator('#note-title').fill('');
  await page.locator('#editor').focus();
  await page.reload();
  assert.equal(await page.locator('#note-title').inputValue(), '');
  await page.getByRole('button', { name: 'Copy', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Download', exact: true }).waitFor();
});

test('empty title blur creates no empty note and default capabilities remain silent', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#note-title').focus();
  await page.locator('#editor').focus();
  assert.equal(await page.locator('.archive-item').count(), 0);
  assert.equal(await page.locator('#speech-capabilities').textContent(), '');
  assert.equal(await page.locator('#speech-capabilities').isVisible(), false);
  assert.match(await page.locator('#dictionary-help').textContent(), /normal spelling, not a pronunciation/);
});


test('saving a title on blur preserves the click on another archived note', async t => {
  const page = await setup(t, 'First body', 10);
  await page.locator('#record-button').click();
  await page.locator('#note-title').fill('First');
  await page.locator('#new-button').click();
  await page.locator('#note-title').fill('Second');
  await page.locator('.archive-open').filter({ hasText: 'First' }).click();
  assert.equal(await value(page), 'First body');
  assert.equal(await page.locator('#note-title').inputValue(), 'First');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dictatus_v1')));
  assert.ok(saved.notes.some(note => note.title === 'Second'));
});


test('spellchecking language matches dictation instead of the English interface', async t => {
  const page = await setup(t, '', 0, { locale: 'de-DE' });
  assert.equal(await page.locator('#editor').getAttribute('lang'), 'de-DE');
  assert.equal(await page.locator('#editor').evaluate(e => e.spellcheck), true);
  assert.equal(await page.evaluate(() => sessions.at(-1).lang), 'de-DE');
});

test('selected misspelling opens a correction form and persists a future dictation rule', async t => {
  const page = await setup(t, 'keen wah', 8);
  await page.locator('#editor').evaluate(e => { e.focus(); e.setSelectionRange(0, 8); });
  await page.locator('#selection-correction').click();
  assert.equal(await page.locator('#heard-entry').inputValue(), 'keen wah');
  assert.equal(await page.locator('#replacement-entry').evaluate(e => e === document.activeElement), true);
  await page.locator('#replacement-entry').fill('quinoa');
  await page.locator('#replacement-entry').press('Enter');
  assert.equal(await value(page), 'keen wah');
  await page.reload();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(e.value.length, e.value.length));
  await page.locator('#record-button').click();
  await emit(page, [['keen wah', true]]);
  assert.equal(await value(page), 'keen wah quinoa');
});

test('selection correction shortcut rejects absent and multiline selections without losing drafts', async t => {
  const page = await setup(t, 'first\nsecond', 0);
  await page.keyboard.press('Alt+Shift+l');
  assert.match(await page.locator('#toast').textContent(), /Select the incorrectly/);
  await page.locator('#heard-entry').evaluate(e => e.value = 'keep draft');
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, e.value.length));
  await page.keyboard.press('Alt+Shift+l');
  assert.match(await page.locator('#toast').textContent(), /one line/);
  assert.equal(await page.locator('#heard-entry').inputValue(), 'keep draft');
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.keyboard.press('Alt+Shift+l');
  assert.equal(await page.locator('#heard-entry').inputValue(), 'first');
});

test('adding a correction during Android dictation applies it to the next phrase without resuming', async t => {
  const page = await setup(t, 'keen wah', 8, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true });
  await page.locator('#editor').evaluate(e => { e.focus(); e.setSelectionRange(0, 8); });
  await page.locator('#selection-correction').click();
  await page.locator('#replacement-entry').fill('quinoa');
  await page.locator('#replacement-entry').press('Enter');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
  await page.evaluate(() => sessions[0].emit([['obsolete', true]]));
  assert.equal(await value(page), 'keen wah');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['KEEN WAH', false]]);
  assert.equal(await value(page), 'keen wah quinoa');
  await emit(page, [['keen wah', true]]);
  assert.equal(await value(page), 'keen wah quinoa');
});

test('case-only schubidam correction applies immediately and after reload', async t => {
  const page = await setup(t, 'schubidam', 9, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true });
  await page.locator('#editor').evaluate(e => { e.focus(); e.setSelectionRange(0, 9); });
  await page.locator('#selection-correction').click();
  await page.locator('#replacement-entry').fill('Schubidam');
  await page.locator('#replacement-entry').press('Enter');
  assert.match(await page.locator('#correction-list').textContent(), /schubidam → Schubidam/);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['schubidam', false]]);
  assert.equal(await value(page), 'schubidam Schubidam');
  await emit(page, [['schubidam', true]]);
  assert.equal(await value(page), 'schubidam Schubidam');
  await page.reload();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(e.value.length, e.value.length));
  await page.locator('#record-button').click();
  await emit(page, [['schubidam', true]]);
  assert.equal(await value(page), 'schubidam Schubidam Schubidam');
});


test('compact format panel preserves selection and closes after formatting, Escape and outside click', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.locator('#record-button').click();
  await page.locator('#editor').evaluate(e => { e.focus(); e.setSelectionRange(0, 5); });
  await page.locator('#format-toggle').click();
  assert.equal(await page.locator('#format-menu').isVisible(), true);
  await page.locator('[data-format="bold"]').click();
  assert.equal(await value(page), '**Hello** world');
  assert.equal(await page.locator('#format-menu').isVisible(), false);
  await page.locator('#format-toggle').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-format="h1"]').evaluate(e => e === document.activeElement), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#format-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#format-toggle').evaluate(e => e === document.activeElement), true);
  await page.locator('#format-toggle').click();
  await page.locator('#note-title').click();
  assert.equal(await page.locator('#format-menu').isVisible(), false);
});

test('compact controls and selection action never move the editor at mobile and desktop widths', async t => {
  const page = await setup(t, 'Hello world', 11);
  await page.locator('#record-button').click();
  const position = () => page.locator('#editor').evaluate(e => e.getBoundingClientRect().top + scrollY);
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    await page.locator('#note-title').focus();
    const top = await position();
    assert.equal(await page.locator('#selection-correction').isVisible(), false);
    await page.locator('#editor').evaluate(e => { e.focus(); e.setSelectionRange(0,5); });
    await page.locator('#selection-correction').waitFor({state:'visible'});
    assert.equal(await position(), top);
    await page.locator('#format-toggle').click();
    assert.equal(await position(), top);
    assert.ok((await page.locator('.editor-controls').boundingBox()).height <= 48);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape');
  }
});


test('archive collapses, frees editor width, persists and reopens for search', async t => {
  const page = await setup(t, 'Archived', 8);
  await page.locator('#record-button').click();
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = (await page.locator('#editor').boundingBox()).width;
  await page.locator('#archive-toggle').click();
  assert.equal(await page.locator('#archive-panel').isVisible(), false);
  assert.ok((await page.locator('#editor').boundingBox()).width > before);
  assert.equal(await page.locator('#archive-toggle').getAttribute('aria-expanded'), 'false');
  await page.reload();
  assert.equal(await page.locator('#archive-panel').isVisible(), false);
  await page.keyboard.press('Alt+Shift+f');
  assert.equal(await page.locator('#archive-panel').isVisible(), true);
  assert.equal(await page.locator('#archive-search').evaluate(e => e === document.activeElement), true);
  await page.locator('#archive-close').click();
  assert.equal(await page.locator('#archive-toggle').evaluate(e => e === document.activeElement), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#archive-toggle').click();
  assert.equal(await page.locator('#archive-search').evaluate(e => e === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
});

async function holdKeys(page) {
  await page.keyboard.down('Alt');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Space');
}
async function releaseHoldKeys(page) {
  await page.keyboard.up('Space');
  await page.keyboard.up('Shift');
  await page.keyboard.up('Alt');
}

test('hold shortcut accepts final words after release and never reconnects afterward', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  assert.equal(await page.locator('#status-title').textContent(), 'Listening');
  await page.evaluate(() => { sessions.at(-1).stop = () => { window.stopCalled = true; }; });
  await emit(page, [['hello', false]]);
  await releaseHoldKeys(page);
  assert.equal(await page.evaluate(() => stopCalled), true);
  assert.equal(await page.locator('#status-title').textContent(), 'Finishing…');
  assert.equal(await page.locator('#status-dot').getAttribute('data-phase'), 'finishing');
  await emit(page, [['hello punctuation period', true]]);
  await page.evaluate(() => sessions.at(-1).onend());
  assert.equal(await value(page), 'hello.');
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 2);
});

test('editing during hold finalization protects the edit from late final results', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['hello', false]]);
  await page.evaluate(() => { sessions.at(-1).stop = () => {}; });
  await releaseHoldKeys(page);
  await page.locator('#editor').fill('My correction');
  await emit(page, [['late result', true]]);
  assert.equal(await value(page), 'My correction');
  assert.equal(await page.locator('#record-button').isEnabled(), true);
});

test('pointer hold stops on release outside the button and keeps the editor caret', async t => {
  const page = await setup(t, 'Hello world', 6);
  await page.locator('#record-button').click();
  await page.locator('#record-button').scrollIntoViewIfNeeded();
  const box = await page.locator('#record-button').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['new', true]]);
  await page.mouse.move(2, 2);
  await page.mouse.up();
  assert.equal(await value(page), 'Hello new world');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
});

test('releasing a modifier, pointer cancellation and window blur all end hold recording', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await page.keyboard.up('Alt');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
  await page.keyboard.up('Space');
  await page.keyboard.up('Shift');
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 3);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await emit(page, [['stale', true]]);
  assert.equal(await value(page), '');
  await releaseHoldKeys(page);
  await page.locator('#record-button').scrollIntoViewIfNeeded();
  const box = await page.locator('#record-button').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 4);
  await page.locator('#record-button').evaluate(e => e.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
  await page.mouse.up();
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});

test('hold can be operated with Space on the focused button without inserting spaces', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.locator('#record-button').focus();
  await page.keyboard.down('Space');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['hello', true]]);
  await page.keyboard.up('Space');
  assert.equal(await value(page), 'hello');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});

test('quick release during preparation invalidates the pending hold start', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.evaluate(() => {
    forceBrowserService = false;
    onlineAllowed = false;
    SpeechRecognition.prototype.processLocally = false;
    SpeechRecognition.available = () => new Promise(resolve => { window.resolveAvailability = resolve; });
    SpeechRecognition.install = async () => true;
  });
  await holdKeys(page);
  await page.waitForFunction(() => !!window.resolveAvailability);
  assert.equal(await page.locator('#status-title').textContent(), 'Connecting…');
  await releaseHoldKeys(page);
  await page.evaluate(() => resolveAvailability('available'));
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 1);
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
});

test('Android reconnects only while the hold remains pressed', async t => {
  const page = await setup(t, '', 0, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true });
  await page.locator('#record-button').click();
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['one', true]]);
  await page.evaluate(() => sessions.at(-1).onend());
  assert.equal(await page.locator('#status-title').textContent(), 'Connecting…');
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 3);
  await emit(page, [['two', true]]);
  await releaseHoldKeys(page);
  assert.equal(await value(page), 'one two');
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 3);
});

test('hold shortcut cannot take over an active toggle session', async t => {
  const page = await setup(t, '', 0);
  assert.equal(await page.locator('#record-button').isDisabled(), false);
  await holdKeys(page);
  await releaseHoldKeys(page);
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 1);
});

test('stuck finalization times out without losing visible text', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.clock.install();
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await emit(page, [['visible', false]]);
  await page.evaluate(() => { sessions.at(-1).stop = () => {}; });
  await releaseHoldKeys(page);
  await page.clock.fastForward(5100);
  assert.equal(await page.locator('#status-title').textContent(), 'Could not finish');
  assert.equal(await value(page), 'visible');
  assert.equal(await page.locator('#record-button').isEnabled(), true);
  await emit(page, [['too late', true]]);
  assert.equal(await value(page), 'visible');
});


test('touch hold records until finger release without changing the mobile layout', async t => {
  const page = await setup(t, '', 0, { userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36', hasTouch: true, isMobile: true, viewport: {width:390,height:844} });
  await page.locator('#record-button').click();
  await page.locator('#record-button').scrollIntoViewIfNeeded();
  const box = await page.locator('#record-button').boundingBox();
  const height = (await page.locator('.recording-controls').boundingBox()).height;
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:box.x+20,y:box.y+20}]});
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  assert.equal((await page.locator('.recording-controls').boundingBox()).height, height);
  await emit(page, [['touch phrase', true]]);
  await client.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  assert.equal(await value(page), 'touch phrase');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await client.detach();
});

test('permission failure clears hold state and never restarts on key release', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await holdKeys(page);
  await page.waitForFunction(() => sessions.filter(s => s.onresult).length === 2);
  await page.evaluate(() => { sessions.at(-1).onerror({error:'not-allowed'}); sessions.at(-1).onend(); });
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#status-dot').getAttribute('data-phase'), 'error');
  assert.equal(await page.locator('#record-button').isEnabled(), true);
  await releaseHoldKeys(page);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 2);
});


test('initial mode is neutral and unavailable local speech requires explicit online consent', async t => {
  const page = await setup(t);
  await page.evaluate(() => localStorage.removeItem('dictatus_online_allowed'));
  await page.reload();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Not started');
  await page.locator('#record-button').click();
  await page.locator('#online-consent').waitFor({state: 'visible'});
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 0);
  assert.equal(await page.locator('#mode-badge').textContent(), 'Error');
  await page.locator('#allow-online').click();
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 0);
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Online');
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Paused');
});

test('offline is shown only on start and local failure never starts an online session', async t => {
  const page = await setup(t);
  await page.locator('#record-button').click();
  await page.evaluate(() => {
    forceBrowserService = false;
    onlineAllowed = false;
    SpeechRecognition.prototype.processLocally = false;
    SpeechRecognition.available = async () => 'available';
    SpeechRecognition.prototype.start = function() {};
  });
  await page.locator('#record-button').click();
  await page.waitForFunction(() => sessions.at(-1).onresult);
  assert.equal(await page.locator('#mode-badge').textContent(), 'Checking…');
  assert.equal(await page.evaluate(() => sessions.at(-1).processLocally), true);
  await page.evaluate(() => sessions.at(-1).onstart());
  assert.equal(await page.locator('#mode-badge').textContent(), 'Offline');
  const count = await page.evaluate(() => sessions.length);
  await page.evaluate(() => sessions.at(-1).onerror({error:'network'}));
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => sessions.length), count);
  assert.equal(await page.locator('#mode-badge').textContent(), 'Error');
  assert.equal(await page.locator('#online-consent').isVisible(), true);
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});

test('synchronous start failure clears pending offline indication', async t => {
  const page = await setup(t);
  await page.locator('#record-button').click();
  await page.evaluate(() => {
    forceBrowserService = false;
    onlineAllowed = false;
    SpeechRecognition.prototype.processLocally = false;
    SpeechRecognition.available = async () => 'available';
    SpeechRecognition.prototype.start = () => { throw new DOMException('unsupported', 'NotSupportedError'); };
  });
  await page.locator('#record-button').click();
  await page.locator('#online-consent').waitFor({state: 'visible'});
  assert.equal(await page.locator('#mode-badge').textContent(), 'Error');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});


test('one dictation button toggles on short pointer and keyboard presses', async t => {
  const page = await setup(t, '', 0);
  assert.equal(await page.locator('.recording-controls button').count(), 1);
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  await page.locator('#record-button').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.locator('#status-title').textContent(), 'Listening');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
});

test('cancelled pending press never starts dictation', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  const box = await page.locator('#record-button').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 1);
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
});

async function enableTextTools(page, status = 'available') {
  await page.evaluate(async status => {
    window.toolCalls = [];
    window.destroyedTools = 0;
    for (const [apiName, method] of [['Proofreader','proofread'],['Rewriter','rewrite'],['Summarizer','summarize'],['Translator','translate']]) {
      window[apiName] = {
        availability: async options => { toolCalls.push({ apiName, phase:'availability', options }); return status; },
        create: async options => {
          toolCalls.push({apiName, phase:'create', options: { ...options, signal: undefined, monitor: undefined }});
          return { destroy() { destroyedTools++; }, async [method](input) {
            toolCalls.push({apiName, phase:'run', input});
            if (window.delayTextResult) return new Promise(resolve => { window.resolveTextResult = resolve; });
            return apiName === 'Proofreader' ? {correctedInput:'Fixed text'} : apiName + ' result';
          }};
        }
      };
    }
    await refreshTextTools();
  }, status);
}

test('text actions stay hidden when APIs are absent or unavailable', async t => {
  const page = await setup(t);
  assert.equal(await page.locator('#text-tools').isVisible(), false);
  await enableTextTools(page, 'unavailable');
  assert.equal(await page.locator('#text-tools').isVisible(), false);
  await enableTextTools(page);
  assert.equal(await page.locator('#text-tools button:visible').count(), 4);
  assert.equal(await page.evaluate(() => toolCalls.some(c => c.phase === 'create')), false);
});

test('Fix text previews selection, pauses speech and applies one undoable change', async t => {
  const page = await setup(t, 'Before wrong after', 7);
  await enableTextTools(page);
  await page.locator('#editor').evaluate(e => e.setSelectionRange(7,12));
  await page.locator('#text-fix').click();
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  assert.equal(await page.locator('#text-original').inputValue(), 'wrong');
  await page.locator('#text-run').click();
  await page.locator('#text-apply').waitFor({state:'visible'});
  await page.waitForFunction(() => !document.getElementById('text-apply').disabled);
  assert.equal(await value(page), 'Before wrong after');
  await page.locator('#text-apply').click();
  assert.equal(await value(page), 'Before Fixed text after');
  await page.keyboard.press('Control+z');
  assert.equal(await value(page), 'Before wrong after');
});

test('all four APIs receive language options and return safe plain-text previews', async t => {
  const page = await setup(t, 'Some text', 0);
  await enableTextTools(page);
  for (const [kind, api] of [['fix','Proofreader'],['rewrite','Rewriter'],['summarize','Summarizer'],['translate','Translator']]) {
    await page.locator('#text-' + kind).click();
    if (kind === 'translate') await page.locator('#text-target-language').selectOption('fr');
    await page.locator('#text-run').click();
    await page.waitForFunction(() => !document.getElementById('text-apply').disabled);
    assert.equal(await page.locator('#text-result').inputValue(), kind === 'fix' ? 'Fixed text' : api + ' result');
    const options = await page.evaluate(api => toolCalls.find(c => c.apiName === api && c.phase === 'create').options, api);
    assert.equal(kind === 'translate' ? options.targetLanguage : options.expectedInputLanguages[0], kind === 'translate' ? 'fr' : 'en');
    await page.locator('#text-cancel').click();
    assert.equal(await value(page), 'Some text');
  }
});

test('cancel rejects late results and cleans up the model session', async t => {
  const page = await setup(t, 'Original', 0);
  await enableTextTools(page);
  await page.evaluate(() => { window.delayTextResult = true; });
  await page.locator('#text-rewrite').click();
  await page.locator('#text-run').click();
  await page.waitForFunction(() => !!window.resolveTextResult);
  await page.keyboard.press('Escape');
  await page.evaluate(() => resolveTextResult('Stale result'));
  assert.equal(await value(page), 'Original');
  assert.equal(await page.locator('#text-dialog').isVisible(), false);
  assert.ok(await page.evaluate(() => destroyedTools > 0));
});

test('Apply rejects changes to the underlying editor made while processing', async t => {
  const page = await setup(t, 'Original', 0);
  await enableTextTools(page);
  await page.locator('#text-fix').click();
  await page.locator('#text-run').click();
  await page.waitForFunction(() => !document.getElementById('text-apply').disabled);
  await page.locator('#editor').evaluate(e => { e.value = 'My edit'; e.dispatchEvent(new Event('input', {bubbles:true})); });
  await page.locator('#text-apply').click();
  assert.equal(await value(page), 'My edit');
  assert.match(await page.locator('#text-status').textContent(), /nothing was overwritten/);
});

test('downloadable models require an explicit click and failed processing keeps the original', async t => {
  const page = await setup(t, 'Original', 0);
  await enableTextTools(page, 'downloadable');
  await page.locator('#text-summarize').click();
  await page.waitForFunction(() => !document.getElementById('text-run').disabled);
  assert.match(await page.locator('#text-run').textContent(), /Download/);
  assert.equal(await page.evaluate(() => toolCalls.filter(c => c.phase === 'create').length), 0);
  await page.evaluate(() => { Summarizer.create = async () => { throw new Error('Model download failed'); }; });
  await page.locator('#text-run').click();
  await page.waitForFunction(() => document.getElementById('text-status').textContent.includes('Model download failed'));
  assert.equal(await value(page), 'Original');
  assert.equal(await page.locator('#text-apply').isDisabled(), true);
});

test('unavailable translation pairs disable generation and mobile dialog fits viewport', async t => {
  const page = await setup(t, 'Original', 0, {viewport:{width:320,height:720}});
  await enableTextTools(page);
  await page.locator('#text-translate').click();
  await page.locator('#text-target-language').selectOption('en');
  assert.equal(await page.locator('#text-run').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const box = await page.locator('#text-dialog').boundingBox();
  assert.ok(box.width <= 320 && box.height <= 720);
});


test('online consent persists across reloads and can be revoked immediately', async t => {
  const page = await setup(t);
  await page.reload();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Not started');
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Online');
  assert.equal(await page.locator('#online-consent').isVisible(), false);
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#online-allowed').inputValue(), 'prefer-local');
  await page.locator('#online-allowed').selectOption('local');
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  await page.reload();
  await page.locator('#record-button').click();
  await page.locator('#online-consent').waitFor({state:'visible'});
  assert.equal(await page.evaluate(() => sessions.filter(s => s.onresult).length), 0);
});

test('online permission still prefers local and allows fallback after a local failure', async t => {
  const page = await setup(t);
  await page.locator('#record-button').click();
  await page.evaluate(() => {
    SpeechRecognition.prototype.processLocally = false;
    SpeechRecognition.available = async () => 'available';
  });
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Offline');
  await page.evaluate(() => sessions.at(-1).onerror({error:'network'}));
  await page.waitForFunction(() => document.getElementById('mode-badge').textContent === 'Online');
  assert.equal(await page.locator('#online-consent').isVisible(), false);
  assert.equal(await page.evaluate(() => sessions.at(-1).processLocally), false);
  await page.locator('#record-button').click();
  await page.locator('#record-button').click();
  assert.equal(await page.locator('#mode-badge').textContent(), 'Offline');
});

test('dictation language pauses recording, updates spelling and survives reload', async t => {
  const page = await setup(t);
  await page.locator('#settings-toggle').click();
  await page.locator('#dictation-language').selectOption('de-DE');
  assert.equal(await page.locator('#status-title').textContent(), 'Paused');
  assert.equal(await page.locator('#editor').getAttribute('lang'), 'de-DE');
  await page.locator('#record-button').click();
  assert.equal(await page.evaluate(() => sessions.at(-1).lang), 'de-DE');
  await page.reload();
  assert.equal(await page.locator('#editor').getAttribute('lang'), 'de-DE');
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#dictation-language').inputValue(), 'de-DE');
  await page.locator('#dictation-language').selectOption('auto');
  assert.equal(await page.locator('#editor').getAttribute('lang'), 'en-US');
});

test('compact dialog options configure rewriting and summaries and invalidate old previews', async t => {
  const page = await setup(t, 'Text to improve', 0);
  await enableTextTools(page);
  for (const kind of ['rewrite','summarize']) {
    await page.locator('#text-' + kind).click();
    assert.equal(await page.locator('#text-options').getAttribute('open'), null);
    await page.locator('#text-options summary').click();
    if (kind === 'rewrite') {
      await page.locator('#rewrite-tone').selectOption('more-formal');
      await page.locator('#rewrite-length').selectOption('shorter');
    } else {
      await page.locator('#summary-type').selectOption('tldr');
      await page.locator('#summary-length').selectOption('long');
    }
    await page.locator('#text-run').click();
    await page.waitForFunction(() => !document.getElementById('text-apply').disabled);
    const options = await page.evaluate(() => toolCalls.filter(c => c.phase === 'create').at(-1).options);
    assert.equal(options.length, kind === 'rewrite' ? 'shorter' : 'long');
    assert.equal(kind === 'rewrite' ? options.tone : options.type, kind === 'rewrite' ? 'more-formal' : 'tldr');
    await page.locator(kind === 'rewrite' ? '#rewrite-length' : '#summary-length').selectOption(kind === 'rewrite' ? 'longer' : 'short');
    assert.equal(await page.locator('#text-apply').isDisabled(), true);
    await page.locator('#text-cancel').click();
  }
});

test('translation remembers the last requested target across reloads', async t => {
  const page = await setup(t, 'Translate me', 0);
  await enableTextTools(page);
  await page.locator('#text-translate').click();
  await page.locator('#text-target-language').selectOption('fr');
  await page.locator('#text-run').click();
  await page.waitForFunction(() => !document.getElementById('text-apply').disabled);
  await page.locator('#text-cancel').click();
  await page.reload();
  await enableTextTools(page);
  await page.locator('#text-translate').click();
  assert.equal(await page.locator('#text-target-language').inputValue(), 'fr');
});


test('punctuation settings save on change without a Save button', async t => {
  const page = await setup(t, '', 0);
  await page.locator('#record-button').click();
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#save-speech-settings').count(), 0);
  await page.locator('#command-mode').selectOption('simple');
  await page.locator('#auto-punctuation').check();
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
  await page.reload();
  await page.locator('#settings-toggle').click();
  assert.equal(await page.locator('#command-mode').inputValue(), 'simple');
  assert.equal(await page.locator('#auto-punctuation').isChecked(), true);
});

test('recording control follows visual viewport panning without touching editor state', async t => {
  const page = await setup(t, 'Keep this text', 5);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(2,5));
  await page.evaluate(() => scrollTo(0,200));
  const before = await page.evaluate(() => ({text:editor.value,start:editor.selectionStart,end:editor.selectionEnd,focus:document.activeElement.id,scroll:scrollY}));
  const gap = await page.locator('.recording-controls').evaluate(e => parseFloat(getComputedStyle(e).top));
  for (const offset of [120, 240.5, -20, 0]) {
    await page.evaluate(offset => {
      Object.defineProperty(visualViewport, 'offsetTop', {configurable:true,value:offset});
      visualViewport.dispatchEvent(new Event('resize'));
      visualViewport.dispatchEvent(new Event('scroll'));
    }, offset);
    await page.waitForFunction(({offset,gap}) => parseFloat(getComputedStyle(document.querySelector('.recording-controls')).top) === Math.max(0,offset)+gap, {offset,gap});
    const top = await page.locator('.recording-controls').evaluate(e=>e.getBoundingClientRect().top);
    assert.ok(Math.abs(top-(Math.max(0,offset)+gap)) < 1);
    assert.deepEqual(await page.evaluate(() => ({text:editor.value,start:editor.selectionStart,end:editor.selectionEnd,focus:document.activeElement.id,scroll:scrollY})),before);
  }
});


test('recording clearance follows actual control height and design spacing', async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--recording-edge-gap', '17px');
    document.getElementById('record-button').style.minHeight = '110px';
  });
  await page.waitForFunction(() => {
    const controls = document.querySelector('.recording-controls');
    const height = controls.getBoundingClientRect().height;
    const gap = parseFloat(getComputedStyle(controls).top);
    return parseFloat(getComputedStyle(editor).scrollMarginTop) === height + 2 * gap;
  });
  assert.equal(await page.locator('.recording-controls').evaluate(e => getComputedStyle(e).top), '17px');
});


test('title input saves with confirmation before leaving the field', async t => {
  const page = await setup(t);
  await page.locator('#note-title').fill('A new title');
  await page.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved locally');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('dictatus_v1')).draft.title), 'A new title');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'note-title');
});

test('Markdown downloads use short portable names even without a title', async t => {
  const page = await setup(t, 'A very long text / with : unsafe ? characters '.repeat(10), 0);
  const pending = page.waitForEvent('download');
  await page.locator('#markdown-export-button').click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /^[a-zA-Z0-9_-]{1,48}\.md$/);
  assert.equal(fs.readFileSync(await download.path(), 'utf8'), await value(page));
  for (const [input, expected] of [['CON', 'Dictatus-CON'], ['.. / : ? <>', 'Dictatus'], ['Grüße München', 'Gru-e-Munchen'], ['LPT1', 'Dictatus-LPT1']]) {
    assert.equal(await page.evaluate(input => safeFilename(input), input), expected);
  }
});

test('text actions follow undo, redo and Format above the editor and wrap without overflow', async t => {
  const page = await setup(t);
  await enableTextTools(page);
  const expected = ['undo-button', 'redo-button', 'format-toggle', 'text-rewrite', 'text-summarize', 'text-translate', 'text-fix'];
  assert.deepEqual(await page.locator('.editor-controls button:visible').evaluateAll(buttons => buttons.map(b => b.id)), expected);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({width, height:900});
    const controls = await page.locator('.editor-controls').boundingBox();
    const editorBox = await page.locator('#editor').boundingBox();
    assert.ok(controls.y + controls.height <= editorBox.y);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator('#format-toggle').click();
    const menu = await page.locator('#format-menu').boundingBox();
    assert.ok(menu.y >= controls.y + controls.height);
    await page.keyboard.press('Escape');
  }
});
