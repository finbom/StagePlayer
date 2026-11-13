import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  powerSaveBlocker,
  protocol,
  screen,
} from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DiscardChoice, LoadedShow, LocateResult, MenuCommand, MenuState, RecoveryData, ShowState } from '../shared/types';
import { applyMenuState, buildMenu } from './menu';
import { loadPrefs, savePrefs, type Prefs, type ThemeSetting } from './prefs';
import {
  AUDIO_EXTENSIONS,
  SHOW_EXTENSION,
  deserializeShow,
  expandPaths,
  isAudioPath,
  isShowPath,
  naturalSort,
  serializeShow,
  writeJsonAtomic,
  writeJsonAtomicSync,
  type SavedShow,
} from './showFile';

const APP_NAME = 'StagePlayer';
const SCHEME = 'app';
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const AUDIO_FILTERS = [{ name: 'Audio Files (MP3, WAV)', extensions: AUDIO_EXTENSIONS }];
const SHOW_FILTERS = [{ name: 'StagePlayer Shows', extensions: [SHOW_EXTENSION] }];

// The UI is served from a private app:// scheme instead of file:// (Electron security best practice).
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win: BrowserWindow | null = null;
let prefs: Prefs;
let documentState: { filePath: string | null; dirty: boolean } = { filePath: null, dirty: false };
let menuState: MenuState | null = null;
let allowClose = false;
let keepAwakeId: number | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function start(): void {
  prefs = loadPrefs();
  nativeTheme.themeSource = prefs.theme;

  protocol.handle(SCHEME, (request) => {
    const { pathname } = new URL(request.url);
    const target = path.normalize(path.join(RENDERER_DIR, decodeURIComponent(pathname)));
    if (!target.startsWith(RENDERER_DIR + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(target).toString());
  });

  registerIpc();
  rebuildMenu();
  setKeepAwake(prefs.keepAwake);
  createWindow();
}

function createWindow(): void {
  const bounds = prefs.windowBounds;
  const onScreen = bounds !== null && isOnScreen(bounds);
  win = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: onScreen ? bounds.x : undefined,
    y: onScreen ? bounds.y : undefined,
    minWidth: 900,
    minHeight: 560,
    title: APP_NAME,
    icon: path.join(ASSETS_DIR, 'icon.ico'),
    show: false,
    backgroundColor: backgroundColor(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  if (prefs.windowBounds?.maximized) win.maximize();

  win.once('ready-to-show', () => win?.show());
  win.on('page-title-updated', (e) => e.preventDefault());
  win.webContents.on('will-navigate', (e) => e.preventDefault()); // e.g. a file dropped outside the drop zone
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', onWindowClose);
  win.on('closed', () => {
    win = null;
  });

  updateTitle();
  void win.loadURL(`${SCHEME}://stageplayer/index.html`);
}

/** Only restore the saved window position if it is still on a connected screen. */
function isOnScreen(b: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });
}

// Brand colours: Stage Ink (dark) and Paper (light).
const backgroundColor = () => (nativeTheme.shouldUseDarkColors ? '#17131d' : '#f6f1e7');

// ---------------------------------------------------------------------------
// Window title, closing and crash recovery
// ---------------------------------------------------------------------------

function documentName(): string {
  return documentState.filePath ? path.basename(documentState.filePath, path.extname(documentState.filePath)) : 'Untitled';
}

function updateTitle(): void {
  // Windows convention: "*Name - App" when there are unsaved changes.
  win?.setTitle(`${documentState.dirty ? '*' : ''}${documentName()} - ${APP_NAME}`);
}

function askSaveChanges(): DiscardChoice {
  if (!win) return 'discard';
  const response = dialog.showMessageBoxSync(win, {
    type: 'warning',
    title: APP_NAME,
    message: `Do you want to save changes to ${documentName()}?`,
    detail: "Your changes will be lost if you don't save them.",
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  return response === 0 ? 'save' : response === 1 ? 'discard' : 'cancel';
}

function onWindowClose(event: Electron.Event): void {
  if (!allowClose && documentState.dirty) {
    event.preventDefault();
    const choice = askSaveChanges();
    if (choice === 'save') {
      send({ type: 'saveAndClose' });
    } else if (choice === 'discard') {
      allowClose = true;
      setImmediate(() => win?.close());
    }
    return;
  }
  saveWindowBounds();
  removeRecovery();
}

function saveWindowBounds(): void {
  if (!win) return;
  prefs.windowBounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  savePrefs(prefs);
}

const recoveryPath = () => path.join(app.getPath('userData'), 'recovery.json');

interface RecoveryFile {
  filePath: string | null;
  show: SavedShow;
}

function writeRecovery(data: RecoveryData | null): void {
  if (!data) {
    removeRecovery();
    return;
  }
  try {
    const payload: RecoveryFile = { filePath: data.filePath, show: serializeShow(data.state, null, app.getVersion()) };
    writeJsonAtomicSync(recoveryPath(), payload);
  } catch (err) {
    console.error('Could not write recovery file', err);
  }
}

function removeRecovery(): void {
  try {
    fs.rmSync(recoveryPath(), { force: true });
  } catch {
    // ignore
  }
}

async function getStartupShow(): Promise<LoadedShow | null> {
  if (fs.existsSync(recoveryPath()) && win) {
    try {
      const recovery = JSON.parse(fs.readFileSync(recoveryPath(), 'utf8')) as RecoveryFile;
      const name = recovery.filePath ? path.basename(recovery.filePath) : 'an untitled show';
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning',
        title: APP_NAME,
        message: `${APP_NAME} was not closed properly.`,
        detail: `Unsaved changes to ${name} were recovered. Do you want to restore them?`,
        buttons: ['Restore', 'Discard'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) {
        const { state, missing } = deserializeShow(recovery.show, null);
        return { filePath: recovery.filePath, state, missing, restored: true };
      }
    } catch (err) {
      console.error('Could not read recovery file', err);
    }
    removeRecovery();
  }

  // A show passed on the command line (e.g. "Open with…").
  const arg = process.argv.slice(1).find((a) => isShowPath(a) && fs.existsSync(a));
  return arg ? openShowAt(arg) : null;
}

// ---------------------------------------------------------------------------
// Show files
// ---------------------------------------------------------------------------

function errorText(err: unknown): string {
  if (err instanceof SyntaxError) return 'The file is damaged or is not a StagePlayer show.';
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === 'ENOENT') return 'The file could not be found.';
  if (code === 'EACCES' || code === 'EPERM') return 'Permission denied.';
  return err instanceof Error ? err.message : String(err);
}

async function showError(message: string, err: unknown): Promise<void> {
  if (win) await dialog.showMessageBox(win, { type: 'error', title: APP_NAME, message, detail: errorText(err) });
}

async function openShowAt(filePath: string): Promise<LoadedShow | null> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    const { state, missing } = deserializeShow(raw, filePath);
    addRecent(filePath);
    return { filePath, state, missing, restored: false };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') removeRecent(filePath);
    await showError(`Could not open "${path.basename(filePath)}".`, err);
    return null;
  }
}

async function saveShow(state: ShowState, filePath: string | null): Promise<string | null> {
  let target = filePath;
  if (!target) {
    if (!win) return null;
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Show As',
      defaultPath: path.join(prefs.lastDirectory ?? app.getPath('documents'), `${documentName()}.${SHOW_EXTENSION}`),
      filters: SHOW_FILTERS,
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
    if (!isShowPath(target)) target += `.${SHOW_EXTENSION}`;
  }
  try {
    await writeJsonAtomic(target, serializeShow(state, target, app.getVersion()));
    addRecent(target);
    return target;
  } catch (err) {
    await showError(`Could not save "${path.basename(target)}".`, err);
    return null;
  }
}

function addRecent(filePath: string): void {
  prefs.recentFiles = [filePath, ...prefs.recentFiles.filter((f) => f.toLowerCase() !== filePath.toLowerCase())].slice(0, 10);
  prefs.lastDirectory = path.dirname(filePath);
  savePrefs(prefs);
  rebuildMenu();
}

function removeRecent(filePath: string): void {
  prefs.recentFiles = prefs.recentFiles.filter((f) => f.toLowerCase() !== filePath.toLowerCase());
  savePrefs(prefs);
  rebuildMenu();
}

async function locateFile(missingPath: string, otherMissing: string[]): Promise<LocateResult | null> {
  if (!win) return null;
  const oldDir = path.dirname(missingPath);
  const result = await dialog.showOpenDialog(win, {
    title: `Locate "${path.basename(missingPath)}"`,
    defaultPath: fs.existsSync(oldDir) ? oldDir : (prefs.lastDirectory ?? undefined),
    properties: ['openFile'],
    filters: AUDIO_FILTERS,
  });
  const chosen = result.filePaths[0];
  if (result.canceled || !chosen) return null;

  const relinked: Record<string, string> = { [missingPath]: chosen };
  const newDir = path.dirname(chosen);
  const matches = otherMissing
    .filter((p) => p !== missingPath)
    .map((p) => [p, path.join(newDir, path.basename(p))] as const)
    .filter(([, candidate]) => fs.existsSync(candidate));

  if (matches.length) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: APP_NAME,
      message: `${matches.length} other missing file${matches.length === 1 ? ' was' : 's were'} found in the same folder.`,
      detail: 'Do you want to relink them too?',
      buttons: ['Relink All', 'Only This File'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) for (const [oldPath, newPath] of matches) relinked[oldPath] = newPath;
  }

  prefs.lastDirectory = newDir;
  savePrefs(prefs);
  return { relinked };
}

// ---------------------------------------------------------------------------
// Menu, theme, keep-awake, help
// ---------------------------------------------------------------------------

function send(command: MenuCommand): void {
  win?.webContents.send('menu-command', command);
}

function rebuildMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      prefs,
      state: menuState,
      isDev: !app.isPackaged,
      send,
      clearRecent: () => {
        prefs.recentFiles = [];
        savePrefs(prefs);
        rebuildMenu();
      },
      setTheme,
      setKeepAwake,
      showShortcuts,
      showAbout,
    }),
  );
}

function setTheme(theme: ThemeSetting): void {
  prefs.theme = theme;
  nativeTheme.themeSource = theme;
  win?.setBackgroundColor(backgroundColor());
  savePrefs(prefs);
}

function setKeepAwake(on: boolean): void {
  prefs.keepAwake = on;
  savePrefs(prefs);
  if (on && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && keepAwakeId !== null) {
    powerSaveBlocker.stop(keepAwakeId);
    keepAwakeId = null;
  }
}

function showShortcuts(): void {
  if (!win) return;
  void dialog.showMessageBox(win, {
    type: 'info',
    title: 'Keyboard Shortcuts',
    message: 'Keyboard Shortcuts',
    detail: [
      'Space  —  Play the selected entry / Pause / Resume',
      'Esc  —  Stop (fade out)',
      'Esc again or Shift+Esc  —  Stop everything immediately',
      '↓ / ↑  —  Select next / previous entry',
      '← / →  —  Back / forward 5 seconds',
      'Home / End  —  First / last entry',
      'F2 or Enter  —  Edit cue and comment',
      'Esc (while editing)  —  Leave the text field',
      'Delete  —  Remove entry',
      'Ctrl+↑ / Ctrl+↓  —  Move entry up / down',
      'Ctrl+D  —  Duplicate entry',
      'Ctrl+I  —  Import audio files',
      'Ctrl+Z / Ctrl+Y  —  Undo / Redo',
      'Ctrl+N / Ctrl+O / Ctrl+S  —  New / Open / Save',
      'Ctrl+Plus / Ctrl+Minus  —  Zoom in / out',
    ].join('\n'),
  });
}

function showAbout(): void {
  if (!win) return;
  void dialog.showMessageBox(win, {
    type: 'info',
    title: `About ${APP_NAME}`,
    icon: nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon-256.png')).resize({ width: 64, height: 64 }),
    message: `${APP_NAME} ${app.getVersion()}`,
    detail: `A simple music and sound player for theatre rehearsals.\n\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
  });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc(): void {
  ipcMain.handle('get-startup-show', () => getStartupShow());

  ipcMain.handle('open-show-dialog', async () => {
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Show',
      defaultPath: prefs.lastDirectory ?? undefined,
      properties: ['openFile'],
      filters: [...SHOW_FILTERS, { name: 'All Files', extensions: ['*'] }],
    });
    const file = result.filePaths[0];
    return result.canceled || !file ? null : openShowAt(file);
  });

  ipcMain.handle('open-show-file', (_e, filePath: string) => openShowAt(filePath));
  ipcMain.handle('save-show', (_e, state: ShowState, filePath: string | null) => saveShow(state, filePath));

  ipcMain.handle('import-audio-dialog', async () => {
    if (!win) return [];
    const result = await dialog.showOpenDialog(win, {
      title: 'Import Audio Files',
      defaultPath: prefs.lastDirectory ?? undefined,
      properties: ['openFile', 'multiSelections'],
      filters: AUDIO_FILTERS,
    });
    if (result.canceled || !result.filePaths.length) return [];
    prefs.lastDirectory = path.dirname(result.filePaths[0]!);
    savePrefs(prefs);
    return naturalSort(result.filePaths);
  });

  ipcMain.handle('expand-paths', (_e, paths: string[]) => expandPaths(paths));

  ipcMain.handle('read-audio-file', async (_e, filePath: string) => {
    if (!isAudioPath(filePath)) throw new Error('Not a supported audio file');
    return fs.promises.readFile(filePath);
  });

  ipcMain.handle('check-files', (_e, paths: string[]) => paths.map((p) => fs.existsSync(p)));
  ipcMain.handle('locate-file', (_e, missingPath: string, others: string[]) => locateFile(missingPath, others));
  ipcMain.handle('confirm-discard', () => askSaveChanges());

  ipcMain.on('set-document-state', (_e, state: { filePath: string | null; dirty: boolean }) => {
    documentState = state;
    updateTitle();
  });

  ipcMain.on('update-menu-state', (_e, state: MenuState) => {
    menuState = state;
    applyMenuState(Menu.getApplicationMenu(), state);
  });

  ipcMain.on('write-recovery', (_e, data: RecoveryData | null) => writeRecovery(data));

  ipcMain.on('close-window', () => {
    allowClose = true;
    win?.close();
  });
}
