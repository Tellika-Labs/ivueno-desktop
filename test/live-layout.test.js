const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles', 'app.css'), 'utf8');

/** The declarations of the first rule written as `selector { ... }` on one line. */
function rule(selector) {
  const line = css.split('\n').find((l) => l.startsWith(`${selector} {`));
  assert.ok(line, `${selector} rule exists`);
  return line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
}

// .live-body is a wrapping flex row. A wrapped line grows to its tallest item, so without a height cap the transcript pane grows with the
// transcript, .tr-log never overflows, and setting its scrollTop (follow the latest line) does nothing: the whole page scrolls instead.
// Checked in Chrome with the app's real CSS: without the cap the log was 3658px tall and could not scroll; with it, 607px and it follows the bottom.
test('the transcript pane is capped to the height of the live area so the transcript scrolls inside it', () => {
  assert.match(rule('.pane-tr'), /max-height:\s*100%/);
  assert.match(rule('.tr-log'), /overflow:\s*auto/);
  assert.match(rule('.tr-log'), /min-height:\s*0/);
});
