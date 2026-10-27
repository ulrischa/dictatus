"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "Inline application script is required");

function extractedFunction(startName, endName, parameters) {
  const start = script.indexOf("function " + startName + "(");
  const end = script.indexOf("function " + endName + "(", start);
  assert.ok(start >= 0 && end > start, startName + " was not found");
  return new Function(...parameters, script.slice(start, script.lastIndexOf("\n", end)) + "\nreturn " + startName + ";");
}

function mockEditor(value, start, end = start) {
  return {
    value, selectionStart: start, selectionEnd: end,
    setRangeText(replacement, from, to) {
      this.value = this.value.slice(0, from) + replacement + this.value.slice(to);
      this.selectionStart = this.selectionEnd = from + replacement.length;
    },
    dispatchEvent() {}
  };
}

test("recognition inserts at the caret and subsequent words follow it", () => {
  const editor = mockEditor("Hello world!", 6);
  const insert = extractedFunction("addRecognizedText", "showInterim", ["editor", "Event"])(editor, class Event {});
  insert("wonderful");
  assert.equal(editor.value, "Hello wonderful world!");
  insert("day");
  assert.equal(editor.value, "Hello wonderful day world!");
  assert.equal(editor.selectionStart, editor.selectionEnd);
});

test("dictation preserves selections and follows manually moved caret", () => {
  const editor = mockEditor("Keep this text", 0, 4);
  const insert = extractedFunction("addRecognizedText", "showInterim", ["editor", "Event"])(editor, class Event {});
  insert("Please");
  assert.equal(editor.value, "Keep Please this text");
  editor.selectionStart = editor.selectionEnd = 0;
  insert("Start");
  assert.equal(editor.value, "Start Keep Please this text");
});

test("interim speech preview does not modify edited text", () => {
  const editor = mockEditor("Stay intact", 5);
  const elements = new Map([
    ["interim", { textContent: "", hidden: true }],
    ["status-help", { textContent: "" }]
  ]);
  const show = extractedFunction("showInterim", "selectRecognitionMode", [
    "getElement", "speechActive", "speechError", "listeningDetail"
  ])((id) => elements.get(id), true, "", "On-device · en-US");
  show("maybe new words");
  assert.equal(elements.get("status-help").textContent, "Live preview · maybe new words");
  assert.equal(editor.value, "Stay intact");
  show("");
  assert.equal(elements.get("status-help").textContent, "On-device · en-US");
});
