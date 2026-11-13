import type { Entry, LoadedShow, MenuCommand, MenuState, ShowSettings, ShowState } from '../shared/types.js';
import { api } from './api.js';
import { AudioLibrary, Player } from './audio.js';
import { $, dbToGain, debounce, fileName, formatClock, formatDb, formatDuration, isTextField } from './util.js';

const isMac = api.platform === 'darwin';
const DEFAULT_SETTINGS: ShowSettings = { autoAdvanceOnStop: true, autoAdvanceOnEnd: true, stopFadeSeconds: 0 };
const SEEK_STEP_SECONDS = 5;
const UNDO_LIMIT = 200;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let entries: Entry[] = [];
let settings: ShowSettings = { ...DEFAULT_SETTINGS };
let selectedId: string | null = null;
let filePath: string | null = null;

/** Signature of the show as last saved; differs from signature() when there are unsaved changes. */
let savedSignature = '';
/** Undo works on snapshots of the entry list. */
let lastCommitted = '[]';
const undoStack: string[] = [];
const redoStack: string[] = [];

const missing = new Set<string>();
let loadingId: string | null = null;
let goToken = 0;
/** Remembered so the transport can still show what is playing if its entry is removed. */
let nowPlaying: { cueNumber: string; name: string; cueText: string } | null = null;

const player = new Player();
const library = new AudioLibrary(player.ctx);

const snapshot = () => JSON.stringify(entries);
const signature = () => JSON.stringify({ settings, entries: entries.map(({ id: _id, ...rest }) => rest) });
const isDirty = () => signature() !== savedSignature;
const selectedIndex = () => entries.findIndex((e) => e.id === selectedId);
const selectedEntry = () => entries.find((e) => e.id === selectedId) ?? null;
const entryById = (id: string | null) => (id ? (entries.find((e) => e.id === id) ?? null) : null);
const currentState = (): ShowState => ({ settings, entries, selectedIndex: selectedIndex() });

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

const btnPlay = $<HTMLButtonElement>('#btn-play');
const btnPlayLabel = $('#btn-play-label');
const btnStop = $<HTMLButtonElement>('#btn-stop');
const btnNext = $<HTMLButtonElement>('#btn-next');
const nowCue = $('#now-cue');
const nowName = $('#now-name');
const nowState = $('#now-state');
const nowCueText = $('#now-cuetext');
const progress = $('#progress');
const progressFill = $('#progress-fill');
const progressHandle = $('#progress-handle');
const timeElapsed = $('#time-elapsed');
const timeTotal = $('#time-total');
const timeRemaining = $('#time-remaining');

const playlistEl = $('#playlist');
const rowsEl = $('#rows');
const emptyEl = $('#empty');
const dropIndicator = $('#drop-indicator');

const details = $('#details');
const dTitle = $('#detail-title');
const dCue = $<HTMLInputElement>('#detail-cue');
const dCueText = $<HTMLTextAreaElement>('#detail-cuetext');
const dComment = $<HTMLTextAreaElement>('#detail-comment');
const dVolume = $<HTMLInputElement>('#detail-volume');
const dVolumeValue = $('#detail-volume-value');
const dFile = $('#detail-file');
const dPath = $('#detail-path');
const dLength = $('#detail-length');
const dStatus = $('#detail-status');
const dLocate = $<HTMLButtonElement>('#detail-locate');

const statusCount = $('#status-count');
const statusFile = $('#status-file');
const statusAutoStop = $<HTMLButtonElement>('#status-autostop');
const statusAutoEnd = $<HTMLButtonElement>('#status-autoend');
const statusFade = $('#status-fade');
const toasts = $('#toasts');

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

let renderQueued = false;
let scrollToSelection = false;

/** Re-render everything on the next frame (coalesces many changes into one render). */
function refresh(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderList();
    renderDetails();
    renderStatusBar();
    syncShell();
    library.scanDurations(entries.map((e) => e.path).filter((p) => !missing.has(p)));
    if (scrollToSelection) {
      scrollToSelection = false;
      rowsEl.querySelector('.row.selected')?.scrollIntoView({ block: 'nearest' });
    }
  });
}

type RowStatus = 'playing' | 'paused' | 'loading' | 'missing' | 'error' | '';

function rowStatus(entry: Entry): RowStatus {
  if (player.entryId === entry.id && player.state !== 'stopped') return player.state;
  if (loadingId === entry.id) return 'loading';
  if (missing.has(entry.path)) return 'missing';
  if (library.errors.has(entry.path)) return 'error';
  return '';
}

const STATUS_ICON: Record<RowStatus, string> = {
  playing: '▶',
  paused: '❚❚',
  loading: '…',
  missing: '⚠',
  error: '⚠',
  '': '',
};

function cell(className: string, text: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  div.textContent = text;
  return div;
}

function renderList(): void {
  const fragment = document.createDocumentFragment();
  entries.forEach((entry, i) => {
    const status = rowStatus(entry);
    const row = document.createElement('div');
    row.className = 'row';
    if (entry.id === selectedId) row.classList.add('selected');
    if (status) row.classList.add(`is-${status}`);
    row.dataset.id = entry.id;
    row.draggable = true;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(entry.id === selectedId));
    row.title = entry.path;

    const fileCell = cell('c-file', fileName(entry.path));
    if (entry.volumeDb !== 0) {
      const vol = document.createElement('span');
      vol.className = 'vol';
      vol.textContent = formatDb(entry.volumeDb);
      fileCell.append(vol);
    }
    const duration = library.durations.get(entry.path);
    row.append(
      cell('c-status', STATUS_ICON[status]),
      cell('c-num', String(i + 1)),
      cell('c-cue', entry.cueNumber),
      fileCell,
      cell('c-cuetext', entry.cueText),
      cell('c-comment', entry.comment),
      cell('c-len', duration !== undefined ? formatDuration(duration) : ''),
    );
    fragment.append(row);
  });
  rowsEl.replaceChildren(fragment);
  emptyEl.hidden = entries.length > 0;
}

function setField(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Never overwrite the field the user is typing in.
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

function renderDetails(): void {
  const entry = selectedEntry();
  details.classList.toggle('empty-state', !entry);
  if (!entry) return;

  dTitle.textContent = `Entry ${selectedIndex() + 1} of ${entries.length}`;
  setField(dCue, entry.cueNumber);
  setField(dCueText, entry.cueText);
  setField(dComment, entry.comment);
  if (document.activeElement !== dVolume) dVolume.value = String(entry.volumeDb);
  dVolumeValue.textContent = formatDb(entry.volumeDb);
  dFile.textContent = fileName(entry.path);
  dPath.textContent = entry.path;
  const duration = library.durations.get(entry.path);
  dLength.textContent = duration !== undefined ? `Length ${formatDuration(duration)}` : '';

  const error = missing.has(entry.path) ? 'File not found' : library.errors.get(entry.path)?.message;
  dStatus.hidden = !error;
  dStatus.textContent = error ?? '';
  dLocate.hidden = !error;
}

function renderStatusBar(): void {
  const known = entries.map((e) => library.durations.get(e.path));
  const total = known.reduce<number>((sum, d) => sum + (d ?? 0), 0);
  const allKnown = known.every((d) => d !== undefined);
  statusCount.textContent = entries.length
    ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} · total ${allKnown ? '' : '≥ '}${formatDuration(total)}`
    : 'No entries';
  statusFile.textContent = filePath ?? 'Not saved yet';
  statusAutoStop.textContent = `Auto-advance on stop: ${settings.autoAdvanceOnStop ? 'On' : 'Off'}`;
  statusAutoStop.classList.toggle('on', settings.autoAdvanceOnStop);
  statusAutoEnd.textContent = `Auto-advance on end: ${settings.autoAdvanceOnEnd ? 'On' : 'Off'}`;
  statusAutoEnd.classList.toggle('on', settings.autoAdvanceOnEnd);
  statusFade.textContent = `Stop fade: ${settings.stopFadeSeconds ? `${settings.stopFadeSeconds} s` : 'none'}`;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

let dragPreview: number | null = null;

/** The entry shown in the transport: the loaded one, otherwise the selected one. */
function transportInfo(): { cueNumber: string; name: string; cueText: string; duration: number; position: number } | null {
  if (player.entryId) {
    const loaded = entryById(player.entryId);
    const info = loaded ? { cueNumber: loaded.cueNumber, name: fileName(loaded.path), cueText: loaded.cueText } : nowPlaying;
    return { ...(info ?? { cueNumber: '', name: '', cueText: '' }), duration: player.duration, position: player.position };
  }
  const sel = selectedEntry();
  if (!sel) return null;
  return {
    cueNumber: sel.cueNumber,
    name: fileName(sel.path),
    cueText: sel.cueText,
    duration: library.durations.get(sel.path) ?? 0,
    position: 0,
  };
}

/** Runs every frame; only touches the DOM when something changed. */
function renderTransport(): void {
  const info = transportInfo();
  const duration = info?.duration ?? 0;
  const position = dragPreview ?? info?.position ?? 0;
  const ratio = duration > 0 ? Math.min(1, position / duration) : 0;

  setText(nowCue, info?.cueNumber ?? '');
  setText(nowName, info ? info.name : 'No entry selected');
  setText(nowCueText, info?.cueText ?? '');

  const sel = selectedEntry();
  const loadedIsSelected = !!player.entryId && player.entryId === selectedId;
  let state = 'Stopped';
  if (loadingId) state = 'Loading…';
  else if (player.state === 'playing') state = 'Playing';
  else if (player.state === 'paused') state = 'Paused';
  else if (sel) state = 'Ready';
  setText(nowState, state);
  nowState.className = `state-pill ${state.toLowerCase().replace('…', '')}`;

  const pct = `${(ratio * 100).toFixed(3)}%`;
  if (progressFill.style.width !== pct) {
    progressFill.style.width = pct;
    progressHandle.style.left = pct;
  }
  progress.classList.toggle('is-playing', player.state === 'playing');
  progress.classList.toggle('is-disabled', duration <= 0);

  setText(timeElapsed, formatClock(position));
  setText(timeTotal, duration > 0 ? formatClock(duration) : '');
  setText(timeRemaining, `−${formatClock(Math.max(0, duration - position))}`);

  const showPause = loadedIsSelected && player.state === 'playing';
  btnPlay.classList.toggle('is-pause', showPause);
  setText(btnPlayLabel, showPause ? 'Pause' : loadedIsSelected && player.state === 'paused' ? 'Resume' : 'Play');
  btnPlay.disabled = !sel;
  btnStop.disabled = player.state === 'stopped' && !player.isFading && !loadingId;
  btnNext.disabled = selectedIndex() >= entries.length - 1;
}

function frame(): void {
  renderTransport();
  requestAnimationFrame(frame);
}

// Window title, menu state and crash recovery live in the main process.
let lastDocState = '';
let lastMenuState = '';
const scheduleRecovery = debounce(() => api.writeRecovery(isDirty() ? { state: currentState(), filePath } : null), 1000);

function syncShell(): void {
  const dirty = isDirty();
  const doc = JSON.stringify({ filePath, dirty });
  if (doc !== lastDocState) {
    lastDocState = doc;
    api.setDocumentState({ filePath, dirty });
  }
  const i = selectedIndex();
  const menu: MenuState = {
    settings,
    canUndo: undoStack.length > 0 || snapshot() !== lastCommitted,
    canRedo: redoStack.length > 0,
    hasSelection: i >= 0,
    canMoveUp: i > 0,
    canMoveDown: i >= 0 && i < entries.length - 1,
  };
  const menuJson = JSON.stringify(menu);
  if (menuJson !== lastMenuState) {
    lastMenuState = menuJson;
    api.updateMenuState(menu);
  }
  scheduleRecovery();
}

function toast(message: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  toasts.append(el);
  while (toasts.children.length > 3) toasts.firstElementChild?.remove();
  window.setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}

// ---------------------------------------------------------------------------
// Editing and undo
// ---------------------------------------------------------------------------

/** Record an undo step if the entry list changed since the last one. */
function checkpoint(): void {
  const now = snapshot();
  if (now === lastCommitted) return;
  undoStack.push(lastCommitted);
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  lastCommitted = now;
}

function mutate(change: () => void): void {
  change();
  checkpoint();
  refresh();
}

function restore(json: string): void {
  entries = JSON.parse(json) as Entry[];
  lastCommitted = json;
  if (!selectedEntry()) selectedId = entries[Math.min(Math.max(0, selectedIndex()), entries.length - 1)]?.id ?? null;
  scrollToSelection = true;
  refresh();
  void recheckMissing();
}

function undo(): void {
  checkpoint();
  const previous = undoStack.pop();
  if (previous === undefined) return;
  redoStack.push(lastCommitted);
  restore(previous);
}

function redo(): void {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(lastCommitted);
  restore(next);
}

function newEntry(path: string): Entry {
  return { id: crypto.randomUUID(), path, cueNumber: '', cueText: '', comment: '', volumeDb: 0 };
}

function insertFiles(paths: string[], index = entries.length): void {
  if (!paths.length) return;
  const added = paths.map(newEntry);
  mutate(() => {
    entries.splice(Math.max(0, Math.min(index, entries.length)), 0, ...added);
    if (!selectedEntry()) selectedId = added[0]!.id;
  });
  toast(`Added ${added.length} file${added.length === 1 ? '' : 's'}`, 'ok');
}

function removeSelected(): void {
  const i = selectedIndex();
  if (i < 0) return;
  mutate(() => {
    entries.splice(i, 1);
    selectedId = entries[Math.min(i, entries.length - 1)]?.id ?? null;
  });
}

function duplicateSelected(): void {
  const i = selectedIndex();
  const entry = entries[i];
  if (!entry) return;
  const copy = { ...entry, id: crypto.randomUUID() };
  mutate(() => {
    entries.splice(i + 1, 0, copy);
    selectedId = copy.id;
  });
}

function moveEntry(id: string, toIndex: number): void {
  const from = entries.findIndex((e) => e.id === id);
  if (from < 0) return;
  let to = Math.max(0, Math.min(toIndex, entries.length));
  if (from < to) to--;
  if (from === to) return;
  mutate(() => {
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry!);
    selectedId = id;
  });
  scrollToSelection = true;
}

function moveSelected(delta: -1 | 1): void {
  const i = selectedIndex();
  if (i < 0) return;
  const target = i + delta;
  if (target < 0 || target >= entries.length) return;
  moveEntry(selectedId!, delta > 0 ? target + 1 : target);
}

function editSelected(): void {
  if (!selectedEntry()) return;
  dCue.focus();
  dCue.select();
}

function updateSettings(patch: Partial<ShowSettings>): void {
  settings = { ...settings, ...patch };
  refresh();
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function select(id: string | null, scroll = true): void {
  if (id === selectedId) return;
  // Leave any detail field first, so its edit is recorded for the right entry.
  if (details.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  selectedId = id;
  scrollToSelection = scroll;
  refresh();
  schedulePrefetch();
}

function selectRelative(delta: number): void {
  if (!entries.length) return;
  const i = selectedIndex();
  const next = i < 0 ? 0 : Math.max(0, Math.min(entries.length - 1, i + delta));
  select(entries[next]!.id);
}

/** Select the entry following `id`, but only if the user has not already moved the selection. */
function advanceFrom(id: string): void {
  if (selectedId !== id) return;
  const i = entries.findIndex((e) => e.id === id);
  if (i >= 0 && i < entries.length - 1) select(entries[i + 1]!.id);
}

/** Decode the selected and following entry ahead of time, so Space starts instantly. */
const schedulePrefetch = debounce(() => {
  const i = selectedIndex();
  for (const entry of [entries[i], entries[i + 1]]) {
    if (entry && !missing.has(entry.path)) library.get(entry.path).catch(() => undefined);
  }
}, 150);

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function reportAudioError(entry: Entry, err: unknown): void {
  const error = library.errors.get(entry.path);
  if (error?.missing) missing.add(entry.path);
  const message = error?.message ?? (err instanceof Error ? err.message : String(err));
  toast(`Cannot play "${fileName(entry.path)}": ${message}`, 'error');
  refresh();
}

/** Space / Play: play the selected entry, or pause/resume it if it is the one loaded. */
async function go(): Promise<void> {
  const entry = selectedEntry();
  if (!entry) return;

  if (player.entryId === entry.id) {
    if (player.state === 'playing') player.pause();
    else player.resume();
    return;
  }
  if (loadingId === entry.id) return;
  if (missing.has(entry.path)) {
    toast(`File not found: "${fileName(entry.path)}". Use Locate File… in the panel on the right.`, 'error');
    return;
  }

  const token = ++goToken;
  // Whatever was playing fades out while the new entry starts.
  player.stop(player.state === 'playing' ? settings.stopFadeSeconds : 0);
  loadingId = entry.id;
  refresh();
  try {
    const buffer = await library.get(entry.path);
    if (token !== goToken) return;
    nowPlaying = { cueNumber: entry.cueNumber, name: fileName(entry.path), cueText: entry.cueText };
    player.play(entry.id, buffer, dbToGain(entry.volumeDb), 0);
    schedulePrefetch();
  } catch (err) {
    if (token === goToken) reportAudioError(entry, err);
  } finally {
    if (token === goToken) {
      loadingId = null;
      refresh();
    }
  }
}

/** Esc / Stop: fade out. Pressing again while already stopped silences everything at once. */
function stop(): void {
  goToken++;
  loadingId = null;
  if (player.state === 'stopped') {
    panic();
    return;
  }
  const id = player.entryId!;
  player.stop(settings.stopFadeSeconds);
  if (settings.autoAdvanceOnStop) advanceFrom(id);
  refresh();
}

function panic(): void {
  goToken++;
  loadingId = null;
  player.panic();
  refresh();
}

function onEntryEnded(id: string): void {
  if (settings.autoAdvanceOnEnd) advanceFrom(id);
  refresh();
}

function currentDuration(): number {
  if (player.entryId) return player.duration;
  const sel = selectedEntry();
  return sel ? (library.durations.get(sel.path) ?? 0) : 0;
}

/** Seek the loaded entry; if nothing is loaded, cue the selected entry paused at that position. */
async function seekTo(seconds: number): Promise<void> {
  if (player.entryId) {
    player.seek(seconds);
    return;
  }
  const entry = selectedEntry();
  if (!entry || missing.has(entry.path) || loadingId) return;
  try {
    const buffer = await library.get(entry.path);
    if (player.entryId || selectedId !== entry.id) return; // something else happened meanwhile
    nowPlaying = { cueNumber: entry.cueNumber, name: fileName(entry.path), cueText: entry.cueText };
    player.cue(entry.id, buffer, dbToGain(entry.volumeDb), seconds);
  } catch (err) {
    reportAudioError(entry, err);
  }
}

function seekBy(delta: number): void {
  const from = player.entryId ? player.position : 0;
  void seekTo(Math.max(0, from + delta));
}

// ---------------------------------------------------------------------------
// Files: new, open, save, import, locate
// ---------------------------------------------------------------------------

function emptyShow(): LoadedShow {
  return { filePath: null, state: { settings: { ...DEFAULT_SETTINGS }, entries: [], selectedIndex: -1 }, missing: [], restored: false };
}

function applyLoaded(show: LoadedShow): void {
  panic();
  entries = show.state.entries;
  settings = { ...show.state.settings };
  filePath = show.filePath;
  selectedId = entries[show.state.selectedIndex]?.id ?? entries[0]?.id ?? null;
  missing.clear();
  for (const p of show.missing) missing.add(p);
  undoStack.length = 0;
  redoStack.length = 0;
  lastCommitted = snapshot();
  savedSignature = show.restored ? '' : signature();
  nowPlaying = null;
  scrollToSelection = true;
  refresh();
  schedulePrefetch();
  if (show.missing.length) {
    const n = show.missing.length;
    toast(`${n} audio file${n === 1 ? ' was' : 's were'} not found. Select a red entry and click Locate File…`, 'error');
  }
}

/** Asks to save unsaved changes. Returns false if the user cancelled. */
async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const choice = await api.confirmDiscard();
  if (choice === 'cancel') return false;
  if (choice === 'save') return save(false);
  return true;
}

async function newShow(): Promise<void> {
  if (await confirmDiscard()) applyLoaded(emptyShow());
}

async function openShow(path?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const show = path ? await api.openShowFile(path) : await api.openShowDialog();
  if (show) applyLoaded(show);
}

async function save(saveAs: boolean): Promise<boolean> {
  checkpoint();
  const saved = await api.saveShow(currentState(), saveAs ? null : filePath);
  if (!saved) return false;
  filePath = saved;
  savedSignature = signature();
  refresh();
  toast(`Saved ${fileName(saved)}`, 'ok');
  return true;
}

async function importViaDialog(): Promise<void> {
  insertFiles(await api.importAudioDialog());
}

async function handleDroppedPaths(paths: string[], index: number): Promise<void> {
  if (!paths.length) return;
  const result = await api.expandPaths(paths);
  if (!result.audio.length && result.shows[0]) {
    await openShow(result.shows[0]);
    return;
  }
  insertFiles(result.audio, index);
  if (result.ignored || result.shows.length) {
    const n = result.ignored + result.shows.length;
    toast(`${n} item${n === 1 ? ' was' : 's were'} skipped. Only MP3 and WAV files can be added.`, 'info');
  }
}

async function locateSelected(): Promise<void> {
  const entry = selectedEntry();
  if (!entry) return;
  const result = await api.locateFile(entry.path, [...missing]);
  if (!result) return;
  mutate(() => {
    for (const e of entries) {
      const newPath = result.relinked[e.path];
      if (newPath) e.path = newPath;
    }
  });
  for (const [oldPath, newPath] of Object.entries(result.relinked)) {
    missing.delete(oldPath);
    missing.delete(newPath);
    library.clearError(oldPath);
    library.clearError(newPath);
  }
  const n = Object.keys(result.relinked).length;
  toast(`Relinked ${n} file${n === 1 ? '' : 's'}`, 'ok');
  refresh();
  schedulePrefetch();
}

/** Re-check which files exist (e.g. after a USB drive was plugged back in). */
async function recheckMissing(): Promise<void> {
  const paths = [...new Set(entries.map((e) => e.path))];
  if (!paths.length) return;
  const exists = await api.checkFiles(paths);
  let changed = false;
  paths.forEach((p, i) => {
    if (exists[i] && missing.has(p)) {
      missing.delete(p);
      library.clearError(p);
      changed = true;
    } else if (!exists[i] && !missing.has(p)) {
      missing.add(p);
      changed = true;
    }
  });
  if (changed) refresh();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function handleMenuCommand(command: MenuCommand): void {
  switch (command.type) {
    case 'new': return void newShow();
    case 'open': return void openShow();
    case 'openRecent': return void openShow(command.path);
    case 'save': return void save(false);
    case 'saveAs': return void save(true);
    case 'saveAndClose':
      return void save(false).then((ok) => {
        if (ok) api.closeWindow();
      });
    case 'import': return void importViaDialog();
    case 'undo':
      if (isTextField(document.activeElement)) document.execCommand('undo');
      else undo();
      return;
    case 'redo':
      if (isTextField(document.activeElement)) document.execCommand('redo');
      else redo();
      return;
    case 'edit': return editSelected();
    case 'remove': return removeSelected();
    case 'duplicate': return duplicateSelected();
    case 'moveUp': return moveSelected(-1);
    case 'moveDown': return moveSelected(1);
    case 'playPause': return void go();
    case 'stop': return stop();
    case 'panic': return panic();
    case 'next': return selectRelative(1);
    case 'seekBack': return seekBy(-SEEK_STEP_SECONDS);
    case 'seekForward': return seekBy(SEEK_STEP_SECONDS);
    case 'setAutoAdvanceOnStop': return updateSettings({ autoAdvanceOnStop: command.value });
    case 'setAutoAdvanceOnEnd': return updateSettings({ autoAdvanceOnEnd: command.value });
    case 'setStopFade': return updateSettings({ stopFadeSeconds: command.value });
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  const target = e.target as Element | null;
  if (isTextField(target)) {
    if (e.key === 'Escape') {
      e.preventDefault();
      (target as HTMLElement).blur();
      rowsEl.focus();
    }
    return; // typing goes to the field
  }
  if (e.ctrlKey || e.altKey || e.metaKey) return; // handled by the menu
  const onSlider = target instanceof HTMLInputElement && target.type === 'range';

  switch (e.key) {
    case ' ':
      e.preventDefault();
      if (!e.repeat) void go();
      break;
    case 'Escape':
      e.preventDefault();
      if (e.repeat) break;
      if (e.shiftKey) panic();
      else stop();
      break;
    case 'ArrowDown':
    case 'ArrowUp':
      if (onSlider) return;
      e.preventDefault();
      selectRelative(e.key === 'ArrowDown' ? 1 : -1);
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (onSlider) return;
      e.preventDefault();
      seekBy(e.key === 'ArrowRight' ? SEEK_STEP_SECONDS : -SEEK_STEP_SECONDS);
      break;
    case 'Home':
    case 'End':
      if (onSlider || !entries.length) return;
      e.preventDefault();
      select(entries[e.key === 'Home' ? 0 : entries.length - 1]!.id);
      break;
    case 'Backspace': // the "delete" key on a Mac keyboard
      if (!isMac) return;
    // falls through
    case 'Delete':
      if (onSlider) return;
      e.preventDefault();
      removeSelected();
      break;
    case 'Enter':
    case 'F2':
      e.preventDefault();
      editSelected();
      break;
  }
}

function bindDetailField(input: HTMLInputElement | HTMLTextAreaElement, key: 'cueNumber' | 'cueText' | 'comment'): void {
  input.addEventListener('input', () => {
    const entry = selectedEntry();
    if (!entry) return;
    entry[key] = input.value;
    refresh();
  });
  input.addEventListener('change', () => {
    checkpoint();
    refresh();
  });
}

let dragEntryId: string | null = null;

function dropIndex(e: DragEvent): number {
  const listRect = rowsEl.getBoundingClientRect();
  if (e.clientY < listRect.top || e.clientY > listRect.bottom || e.clientX < listRect.left || e.clientX > listRect.right) {
    return entries.length; // dropped elsewhere in the window: add at the end
  }
  const rows = Array.from(rowsEl.children);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) return i;
  }
  return rows.length;
}

function showDropIndicator(index: number): void {
  const rows = Array.from(rowsEl.children);
  const base = playlistEl.getBoundingClientRect();
  const listRect = rowsEl.getBoundingClientRect();
  let y = listRect.top + 2;
  if (rows.length) y = index < rows.length ? rows[index]!.getBoundingClientRect().top : rows[rows.length - 1]!.getBoundingClientRect().bottom;
  y = Math.max(listRect.top + 1, Math.min(listRect.bottom - 2, y));
  dropIndicator.style.top = `${y - base.top - 1}px`;
  dropIndicator.hidden = false;
}

function hideDropIndicator(): void {
  dropIndicator.hidden = true;
  playlistEl.classList.remove('drag-over');
}

function progressPosition(e: PointerEvent, duration: number): number {
  const r = progress.getBoundingClientRect();
  return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
}

function bindEvents(): void {
  api.onMenuCommand(handleMenuCommand);
  window.addEventListener('keydown', handleKeyDown, true);
  // Stop Space from also "clicking" a focused button.
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ' && !isTextField(e.target as Element)) e.preventDefault();
  }, true);
  window.addEventListener('focus', () => void recheckMissing());

  // Buttons never take keyboard focus away from the playlist, and clicking one
  // leaves any text field so that Space goes back to meaning "play".
  for (const button of document.querySelectorAll<HTMLButtonElement>('.transport button, .toolbar button, .statusbar button')) {
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', () => {
      if (isTextField(document.activeElement)) document.activeElement.blur();
    });
  }

  btnPlay.addEventListener('click', () => void go());
  btnStop.addEventListener('click', stop);
  btnNext.addEventListener('click', () => selectRelative(1));

  $('#tb-add').addEventListener('click', () => void importViaDialog());
  $('#tb-remove').addEventListener('click', removeSelected);
  $('#tb-up').addEventListener('click', () => moveSelected(-1));
  $('#tb-down').addEventListener('click', () => moveSelected(1));
  $('#tb-duplicate').addEventListener('click', duplicateSelected);
  $('#empty-import').addEventListener('click', () => void importViaDialog());

  statusAutoStop.addEventListener('click', () => updateSettings({ autoAdvanceOnStop: !settings.autoAdvanceOnStop }));
  statusAutoEnd.addEventListener('click', () => updateSettings({ autoAdvanceOnEnd: !settings.autoAdvanceOnEnd }));

  // Playlist rows
  rowsEl.addEventListener('mousedown', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    if (row?.dataset.id) select(row.dataset.id, false);
  });
  rowsEl.addEventListener('dblclick', (e) => {
    if ((e.target as Element).closest('.row')) editSelected();
  });

  // Details panel
  bindDetailField(dCue, 'cueNumber');
  bindDetailField(dCueText, 'cueText');
  bindDetailField(dComment, 'comment');
  dVolume.addEventListener('input', () => {
    const entry = selectedEntry();
    if (!entry) return;
    entry.volumeDb = Number(dVolume.value);
    if (player.entryId === entry.id) player.setGain(dbToGain(entry.volumeDb));
    refresh();
  });
  dVolume.addEventListener('change', () => {
    checkpoint();
    refresh();
  });
  $('#detail-volume-reset').addEventListener('click', () => {
    const entry = selectedEntry();
    if (!entry || entry.volumeDb === 0) return;
    mutate(() => {
      entry.volumeDb = 0;
    });
    if (player.entryId === entry.id) player.setGain(1);
  });
  dLocate.addEventListener('click', () => void locateSelected());

  // Progress bar: click or drag to seek.
  progress.addEventListener('pointerdown', (e) => {
    const duration = currentDuration();
    if (duration <= 0) return;
    progress.setPointerCapture(e.pointerId);
    dragPreview = progressPosition(e, duration);
  });
  progress.addEventListener('pointermove', (e) => {
    if (dragPreview !== null) dragPreview = progressPosition(e, currentDuration());
  });
  progress.addEventListener('pointerup', () => {
    if (dragPreview === null) return;
    const target = dragPreview;
    dragPreview = null;
    void seekTo(target);
  });
  progress.addEventListener('pointercancel', () => {
    dragPreview = null;
  });

  // Drag and drop: files from Explorer, and reordering rows.
  rowsEl.addEventListener('dragstart', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.row');
    if (!row?.dataset.id || !e.dataTransfer) return;
    dragEntryId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', fileName(entryById(dragEntryId)?.path ?? ''));
    row.classList.add('dragging');
  });
  rowsEl.addEventListener('dragend', () => {
    dragEntryId = null;
    hideDropIndicator();
    rowsEl.querySelector('.dragging')?.classList.remove('dragging');
  });
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!e.dataTransfer) return;
    const hasFiles = e.dataTransfer.types.includes('Files');
    if (!hasFiles && !dragEntryId) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.dataTransfer.dropEffect = hasFiles ? 'copy' : 'move';
    playlistEl.classList.toggle('drag-over', hasFiles);
    showDropIndicator(dropIndex(e));
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) hideDropIndicator();
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    hideDropIndicator();
    const index = dropIndex(e);
    if (dragEntryId) {
      moveEntry(dragEntryId, index);
      dragEntryId = null;
      return;
    }
    const files = Array.from(e.dataTransfer?.files ?? []);
    const paths = files.map((f) => api.getPathForFile(f)).filter(Boolean);
    void handleDroppedPaths(paths, index);
  });

  player.onStateChange = refresh;
  player.onEnded = onEntryEnded;
  library.onChange = refresh;
}

/** Show Mac shortcut symbols in tooltips (the HTML is written with Windows names). */
function adaptToPlatform(): void {
  document.documentElement.dataset.platform = api.platform;
  if (!isMac) return;
  for (const el of document.querySelectorAll<HTMLElement>('[title]')) {
    el.title = el.title.replace(/Ctrl\+/g, '⌘').replace('(Delete)', '(⌫)');
  }
}

async function init(): Promise<void> {
  adaptToPlatform();
  bindEvents();
  applyLoaded((await api.getStartupShow()) ?? emptyShow());
  requestAnimationFrame(frame);
  rowsEl.focus();
}

void init();
