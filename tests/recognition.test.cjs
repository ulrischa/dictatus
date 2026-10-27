'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || process.cwd()] }));
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH }); });
after(async () => { await browser?.close(); });
async function setup(t, text = 'Hello world!', position = 6) {
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US' });
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

test('editing before the live range preserves the edit, selection and dictation location', async t => {
  const page = await setup(t);
  await emit(page, [['wonder', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.keyboard.insertText('Good morning');
  await emit(page, [['wonderful', true]]);
  assert.equal(await value(page), 'Good morning wonderful world!');
  assert.deepEqual(await page.locator('#editor').evaluate(e => [e.selectionStart, e.selectionEnd]), [12, 12]);
});

test('editing provisional text stops recognition and ignores late results', async t => {
  const page = await setup(t);
  await emit(page, [['wonder', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(6, 12));
  await page.keyboard.insertText('lovely');
  await emit(page, [['wonderful', true]]);
  assert.equal(await value(page), 'Hello lovely world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});

test('speech settings request continuous interim results', async t => {
  const page = await setup(t);
  assert.deepEqual(await page.evaluate(() => [sessions.at(-1).continuous, sessions.at(-1).interimResults]), [true, true]);
});

test('edits after the live range and a selected word survive speech revisions', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(e.value.length - 6, e.value.length));
  await page.keyboard.insertText('planet!');
  await page.locator('#editor').evaluate(e => e.setSelectionRange(e.value.length - 7, e.value.length));
  await emit(page, [['beautiful', true]]);
  assert.equal(await value(page), 'Hello beautiful planet!');
  assert.equal(await page.locator('#editor').evaluate(e => e.value.slice(e.selectionStart, e.selectionEnd)), 'planet!');
});

test('markdown changes shift the live range and undo stops before restoring text', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(0, 5));
  await page.locator('[data-format="bold"]').click();
  await emit(page, [['beautiful', true]]);
  assert.equal(await value(page), '**Hello** beautiful world!');
  await page.locator('#editor').press('Control+z');
  assert.equal(await value(page), '**Hello** nice world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
  await page.locator('#editor').press('Control+Shift+z');
  assert.equal(await value(page), '**Hello** beautiful world!');
});

test('composition defers speech and flushes after the committed edit', async t => {
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
  assert.equal(await value(page), 'Hi nice world!');
  await page.locator('#editor').evaluate(e => e.dispatchEvent(new CompositionEvent('compositionend')));
  await page.waitForFunction(() => document.getElementById('editor').value === 'Hi beautiful world!');
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

test('deleting repeated characters before the range keeps its exact location', async t => {
  const page = await setup(t, 'aaaa END', 4);
  await page.locator('#editor').focus();
  await page.locator('#editor').evaluate(e => e.setSelectionRange(1, 1));
  await page.keyboard.press('Backspace');
  await emit(page, [['word', true]]);
  assert.equal(await value(page), 'aaa word END');
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

test('edits without beforeinput are preserved and stop dictation conservatively', async t => {
  const page = await setup(t);
  await emit(page, [['nice', false]]);
  await page.locator('#editor').evaluate(e => {
    e.value = 'Changed ' + e.value;
    e.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText' }));
  });
  await emit(page, [['different', true]]);
  assert.equal(await value(page), 'Changed Hello nice world!');
  assert.equal(await page.locator('#record-button').getAttribute('aria-pressed'), 'false');
});
