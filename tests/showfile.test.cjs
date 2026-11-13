// Tests for the .stageshow file format and relinking, including Windows <-> macOS moves.
// Run with: npm test   (builds first, then tests the compiled dist/main/showFile.js)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const sf = require('../dist/main/showFile.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stageplayer-test-'));
const touch = (...parts) => {
  const p = path.join(root, ...parts);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, 'x');
  return p;
};
const entry = (p, extra = {}) => ({ id: 'x', path: p, cueNumber: '', cueText: '', comment: '', volumeDb: 0, ...extra });
const settings = { autoAdvanceOnStop: false, autoAdvanceOnEnd: true, stopFadeSeconds: 3 };
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

console.log('showFile');

test('round trip keeps all data and stores relative paths with /', () => {
  const a = touch('show1/audio/a.wav');
  const b = touch('show1/audio/b.mp3');
  const showPath = path.join(root, 'show1/My Show.stageshow');
  const state = {
    settings,
    selectedIndex: 1,
    entries: [entry(a, { cueNumber: 'Q1', cueText: 'Line "quoted"', comment: 'åäö\nline 2', volumeDb: -4.5 }), entry(b)],
  };
  const saved = sf.serializeShow(state, showPath, 'test');
  assert.equal(saved.entries[0].file, 'audio/a.wav');
  fs.writeFileSync(showPath, JSON.stringify(saved));
  const loaded = sf.deserializeShow(JSON.parse(fs.readFileSync(showPath, 'utf8')), showPath);
  assert.deepEqual(loaded.missing, []);
  assert.equal(loaded.state.entries[0].path, a);
  assert.equal(loaded.state.entries[0].comment, 'åäö\nline 2');
  assert.equal(loaded.state.entries[0].volumeDb, -4.5);
  assert.deepEqual(loaded.state.settings, settings);
  assert.equal(loaded.state.selectedIndex, 1);
});

test('show saved on another OS opens here (relative path wins over foreign absolute path)', () => {
  const a = touch('show2/audio/a.wav');
  const showPath = path.join(root, 'show2/Show.stageshow');
  const fromMac = { file: 'audio/a.wav', absolutePath: '/Volumes/USB/Show/audio/a.wav', cueNumber: 'Q1', cueText: '', comment: '', volumeDb: 0 };
  const fromWin = { ...fromMac, absolutePath: 'C:\\Users\\Someone\\Show\\audio\\a.wav' };
  for (const e of [fromMac, fromWin]) {
    const raw = { format: 'StagePlayer show', formatVersion: 1, settings, selectedIndex: 0, entries: [e] };
    const loaded = sf.deserializeShow(raw, showPath);
    assert.deepEqual(loaded.missing, []);
    assert.equal(loaded.state.entries[0].path, a);
  }
});

test('relative path written with backslashes still resolves', () => {
  const a = touch('show3/sfx/door.wav');
  const raw = { format: 'StagePlayer show', formatVersion: 1, entries: [{ file: 'sfx\\door.wav' }] };
  const loaded = sf.deserializeShow(raw, path.join(root, 'show3/Show.stageshow'));
  assert.deepEqual(loaded.missing, []);
  assert.equal(loaded.state.entries[0].path, a);
});

test('Å/Ä/Ö file names match in both Unicode forms (macOS NFD vs Windows NFC)', () => {
  const real = touch('show4/audio', 'Överture.wav'.normalize('NFC'));
  const raw = { format: 'StagePlayer show', formatVersion: 1, entries: [{ file: 'audio/' + 'Överture.wav'.normalize('NFD') }] };
  const loaded = sf.deserializeShow(raw, path.join(root, 'show4/Show.stageshow'));
  assert.deepEqual(loaded.missing, []);
  assert.equal(loaded.state.entries[0].path.normalize('NFC'), real.normalize('NFC'));
  const saved = sf.serializeShow(loaded.state, path.join(root, 'show4/Show.stageshow'), 'test');
  assert.equal(saved.entries[0].file, 'audio/' + 'Överture.wav'.normalize('NFC'));
});

test('missing file is found by name elsewhere in the show folder', () => {
  const moved = touch('show5/music/act 1/song.mp3');
  const raw = { format: 'StagePlayer show', formatVersion: 1, entries: [{ file: 'audio/song.mp3', absolutePath: 'C:\\old\\song.mp3' }] };
  const loaded = sf.deserializeShow(raw, path.join(root, 'show5/Show.stageshow'));
  assert.deepEqual(loaded.missing, []);
  assert.equal(loaded.state.entries[0].path, moved);
});

test('truly missing files are reported, not fatal; bad files are rejected', () => {
  const raw = { format: 'StagePlayer show', formatVersion: 1, entries: [{ file: 'audio/nothing.wav' }] };
  const loaded = sf.deserializeShow(raw, path.join(root, 'show6/Show.stageshow'));
  assert.equal(loaded.missing.length, 1);
  assert.throws(() => sf.deserializeShow({ hello: 1 }, null), /not a StagePlayer show/);
  assert.throws(() => sf.deserializeShow({ ...raw, formatVersion: 99 }, null), /newer version/);
});

test('relinking: one located file finds the others (folder moved, even from the other OS)', () => {
  const newA = touch('usb/Show/audio/a.wav');
  const newB = touch('usb/Show/sfx/b.wav');
  const newC = touch('usb/Show/audio/c.wav');
  const newD = touch('usb/Show/audio/deep/d.wav');
  const missing = [
    'C:\\Theatre\\Show\\audio\\a.wav',
    'C:\\Theatre\\Show\\sfx\\b.wav', // same structure, other folder
    '/Volumes/Old/c.wav', // different origin, same folder as located file
    'D:\\elsewhere\\d.wav', // only findable by searching subfolders
    'C:\\Theatre\\Show\\audio\\gone.wav', // does not exist anywhere
  ];
  const result = sf.findRelinks(missing[0], newA, missing);
  assert.deepEqual(result, { [missing[1]]: newB, [missing[2]]: newC, [missing[3]]: newD });
});

test('dropping folders ignores hidden files such as macOS "._" files', async () => {
  touch('drop/01.wav');
  touch('drop/._01.wav');
  touch('drop/.hidden/02.wav');
  touch('drop/sub/03.mp3');
  return sf.expandPaths([path.join(root, 'drop')]).then((r) => {
    assert.deepEqual(r.audio.map((p) => path.relative(path.join(root, 'drop'), p).split(path.sep).join('/')), ['01.wav', 'sub/03.mp3']);
  });
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${String(err.stack ?? err).split('\n').join('\n    ')}`);
    }
  }
  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
