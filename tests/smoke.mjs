// Smoke test: starts the app with a generated test show, drives it with the keyboard over the
// Chrome DevTools Protocol, checks the result and saves screenshots.
//
//   node tests/smoke.mjs                       -> runs the development build (npm run build first)
//   node tests/smoke.mjs <path to executable>  -> runs a packaged app
//   SMOKE_OUT=dir                              -> where screenshots go (default: smoke-output)
//
// Checks that need a working sound device (playing to the end) only warn, because CI machines
// often have no audio output.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PORT = 9333;
const outDir = resolve(process.env.SMOKE_OUT ?? 'smoke-output');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(outDir, { recursive: true });

// ---- Test show: three tones, one missing file, relative paths, an Å/Ä/Ö name ----
const dir = mkdtempSync(join(tmpdir(), 'stageplayer-smoke-'));
mkdirSync(join(dir, 'audio'));
function wav(name, seconds, freq) {
  const rate = 44100;
  const n = Math.floor(rate * seconds);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 3000), 44 + i * 2);
  writeFileSync(join(dir, 'audio', name), b);
}
wav('01 Överture.wav', 2, 440);
wav('02 Doorbell.wav', 12, 660);
wav('03 Finale.wav', 2, 330);
const e = (file, cueNumber, cueText, comment = '') => ({ file: `audio/${file}`, absolutePath: '', cueNumber, cueText, comment, volumeDb: 0 });
const showPath = join(dir, 'Smoke Test.stageshow');
writeFileSync(showPath, JSON.stringify({
  format: 'StagePlayer show', formatVersion: 1, savedWith: 'smoke', savedAt: new Date().toISOString(),
  settings: { autoAdvanceOnStop: true, autoAdvanceOnEnd: true, stopFadeSeconds: 0 },
  selectedIndex: 0,
  entries: [
    e('01 Överture.wav', 'Q1', 'House lights down', 'Start on SM call'),
    e('02 Doorbell.wav', 'Q2', 'After Anna: "Who could that be?" p.12'),
    e('03 Finale.wav', 'Q3', 'Final bow', 'Long fade'),
    e('99 Missing.wav', 'Q4', 'This one is missing'),
  ],
}));

// ---- Launch ----
const exe = process.argv[2];
const require = createRequire(import.meta.url);
const [command, args] = exe ? [exe, []] : [require('electron'), ['.']];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = spawn(command, [...args, `--remote-debugging-port=${PORT}`, showPath], { env, stdio: 'inherit' });

const failures = [];
const warnings = [];
const check = (ok, message) => { console.log(`  ${ok ? '✓' : '✗'} ${message}`); if (!ok) failures.push(message); };
const soft = (ok, message) => { console.log(`  ${ok ? '✓' : '!'} ${message}`); if (!ok) warnings.push(message); };

try {
  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error('The app did not start (no page found)');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    pending.get(msg.id)?.(msg);
    if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
  const key = async (k, code, keyCode) => {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: keyCode });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
  };
  const shot = async (name) => {
    const r = await cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, `${process.platform}-${name}.png`), Buffer.from(r.result.data, 'base64'));
  };
  const ui = () => evaluate(`({
    state: document.querySelector('#now-state').textContent,
    selected: document.querySelector('.row.selected .c-cue')?.textContent,
    elapsed: document.querySelector('#time-elapsed').textContent,
    rows: [...document.querySelectorAll('.row')].map(r => ({ cls: r.className, len: r.querySelector('.c-len').textContent })),
    overflow: document.documentElement.scrollWidth > innerWidth,
    platform: document.documentElement.dataset.platform,
  })`);
  const waitFor = async (pred, ms = 5000) => { const end = Date.now() + ms; let s; while (Date.now() < end) { s = await ui(); if (pred(s)) return s; await sleep(100); } return s; };

  await cdp('Runtime.enable');
  await cdp('Page.enable');
  console.log(`Smoke test on ${process.platform}`);

  let s = await waitFor((s) => s.rows.length === 4 && s.rows.slice(0, 3).every((r) => r.len));
  check(s.rows.length === 4, 'show opens with 4 entries');
  check(s.rows.slice(0, 3).every((r) => r.len), 'audio files are decoded (lengths shown), incl. Å/Ä/Ö name');
  check(s.rows[3]?.cls.includes('is-missing'), 'missing file is marked');
  check(!s.overflow, 'layout fits the window');
  check(s.platform === process.platform, 'renderer knows the platform');
  await shot('1-light');

  await key(' ', 'Space', 32);
  s = await waitFor((s) => s.state === 'Playing');
  check(s.state === 'Playing', 'Space starts playback');
  await shot('2-playing');

  await key('Escape', 'Escape', 27);
  s = await waitFor((s) => s.selected === 'Q2');
  check(s.state === 'Ready' && s.selected === 'Q2', 'Esc stops and auto-advances to Q2');

  await key('ArrowRight', 'ArrowRight', 39);
  s = await waitFor((s) => s.elapsed === '0:05.0');
  check(s.state === 'Paused' && s.elapsed === '0:05.0', '→ cues Q2 at 5 seconds');

  await key('ArrowDown', 'ArrowDown', 40);
  await key('ArrowDown', 'ArrowDown', 40);
  await key(' ', 'Space', 32);
  s = await waitFor((s) => s.selected === 'Q4', 1000);
  check(s.selected === 'Q4' && s.state !== 'Playing', 'missing file does not play');

  await key('ArrowUp', 'ArrowUp', 38);
  await key('ArrowUp', 'ArrowUp', 38);
  await key('ArrowUp', 'ArrowUp', 38);
  await key(' ', 'Space', 32); // Q1 is 2 s long
  s = await waitFor((s) => s.selected === 'Q2' && s.state === 'Ready', 6000);
  soft(s.selected === 'Q2' && s.state === 'Ready', 'entry plays to the end and auto-advances (needs a sound device)');

  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(300);
  await shot('3-dark');

  check(errors.length === 0, `no errors in the app${errors.length ? ': ' + errors.join(' | ') : ''}`);
  ws.close();
} catch (err) {
  failures.push(String(err));
  console.error(err);
} finally {
  app.kill();
  await sleep(500);
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\nScreenshots: ${outDir}`);
if (warnings.length) console.log(`Warnings: ${warnings.length}`);
if (failures.length) {
  console.log(`FAILED: ${failures.length}`);
  process.exit(1);
}
console.log('Smoke test passed');
process.exit(0);
