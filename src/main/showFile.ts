import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Entry, ExpandedPaths, ShowSettings, ShowState } from '../shared/types';

export const SHOW_EXTENSION = 'stageshow';
export const AUDIO_EXTENSIONS = ['mp3', 'wav'];

const FORMAT = 'StagePlayer show';
const FORMAT_VERSION = 1;

export const DEFAULT_SETTINGS: ShowSettings = {
  autoAdvanceOnStop: true,
  autoAdvanceOnEnd: true,
  stopFadeSeconds: 0,
};

/** One playlist entry as stored in a .stageshow file. */
interface SavedEntry {
  /** Path relative to the show file (always "/" separators), or absolute if on another drive. */
  file: string;
  /** Absolute path at save time, used as a fallback when the relative path does not resolve. */
  absolutePath: string;
  cueNumber: string;
  cueText: string;
  comment: string;
  volumeDb: number;
}

export interface SavedShow {
  format: string;
  formatVersion: number;
  savedWith: string;
  savedAt: string;
  settings: ShowSettings;
  selectedIndex: number;
  entries: SavedEntry[];
}

// ---------------------------------------------------------------------------
// Cross-platform path helpers
//
// A show file may be saved on Windows and opened on macOS, or the other way
// round. Paths are therefore stored relative with "/" separators and in Unicode
// NFC form (macOS file names often use NFD, e.g. "Ö" as "O" + combining "¨"),
// and lookups tolerate both forms and both kinds of separator.
// ---------------------------------------------------------------------------

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalSort = (paths: string[]) => [...paths].sort((a, b) => collator.compare(a, b));

/** Split a path from any OS ("C:\a\b" or "/a/b") into its parts. */
export const splitAnyPath = (p: string) => p.split(/[\\/]+/).filter(Boolean);
export const baseNameAny = (p: string) => splitAnyPath(p).at(-1) ?? '';
/** Key for comparing file names across platforms: NFC and case-insensitive. */
const nameKey = (s: string) => s.normalize('NFC').toLowerCase();

const extensionOf = (p: string) => path.extname(baseNameAny(p)).slice(1).toLowerCase();
const isHidden = (p: string) => baseNameAny(p).startsWith('.'); // includes macOS "._" files on USB sticks
export const isAudioPath = (p: string) => AUDIO_EXTENSIONS.includes(extensionOf(p)) && !isHidden(p);
export const isShowPath = (p: string) => extensionOf(p) === SHOW_EXTENSION;

/** Returns the path as it exists on disk, trying NFC and NFD spellings, or null. */
export function existingPath(p: string): string | null {
  for (const variant of new Set([p, p.normalize('NFC'), p.normalize('NFD')])) {
    if (fs.existsSync(variant)) return variant;
  }
  return null;
}

/** Index of audio files below a folder by file name (bounded, skips hidden folders). */
export function buildAudioIndex(root: string, limit = 20000): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < limit) {
    const dir = stack.pop()!;
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of items) {
      if (++seen > limit) break;
      if (item.name.startsWith('.') || item.name === 'node_modules') continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) stack.push(full);
      else if (isAudioPath(item.name)) {
        const key = nameKey(item.name);
        index.set(key, [...(index.get(key) ?? []), full]);
      }
    }
  }
  return index;
}

/** A single, unambiguous match for a file name in an index. */
function uniqueMatch(index: Map<string, string[]>, fileName: string): string | null {
  const matches = index.get(nameKey(fileName));
  return matches?.length === 1 ? matches[0]! : null;
}

function toPortablePath(filePath: string, baseDir: string | null): string {
  const normalized = filePath.normalize('NFC');
  if (!baseDir) return normalized;
  const rel = path.relative(baseDir, filePath);
  // On Windows a file on another drive cannot be relative; keep it absolute.
  if (!rel || path.isAbsolute(rel)) return normalized;
  return rel.split(path.sep).join('/').normalize('NFC');
}

// ---------------------------------------------------------------------------
// Show files
// ---------------------------------------------------------------------------

export function serializeShow(state: ShowState, showPath: string | null, appVersion: string): SavedShow {
  const baseDir = showPath ? path.dirname(showPath) : null;
  return {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    savedWith: `StagePlayer ${appVersion}`,
    savedAt: new Date().toISOString(),
    settings: { ...state.settings },
    selectedIndex: state.selectedIndex,
    entries: state.entries.map((e) => ({
      file: toPortablePath(e.path, baseDir),
      absolutePath: e.path.normalize('NFC'),
      cueNumber: e.cueNumber,
      cueText: e.cueText,
      comment: e.comment,
      volumeDb: e.volumeDb,
    })),
  };
}

const asString = (v: unknown) => (typeof v === 'string' ? v : '');
const asNumber = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const asBoolean = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Resolve a stored relative path on this OS (it may contain "\" if written by hand or by an old version). */
function resolveStored(baseDir: string, file: string): string {
  const native = path.sep === '/' ? file.replace(/\\/g, '/') : file;
  return path.resolve(baseDir, native);
}

export function deserializeShow(raw: unknown, showPath: string | null): { state: ShowState; missing: string[] } {
  const data = (raw ?? {}) as Partial<SavedShow>;
  if (data.format !== FORMAT || !Array.isArray(data.entries)) {
    throw new Error('The file is not a StagePlayer show.');
  }
  if (typeof data.formatVersion === 'number' && data.formatVersion > FORMAT_VERSION) {
    throw new Error('This show was saved by a newer version of StagePlayer. Please update the app to open it.');
  }

  const baseDir = showPath ? path.dirname(showPath) : process.cwd();
  let showFolderIndex: Map<string, string[]> | null = null; // built only if something is missing
  const missing: string[] = [];

  const entries: Entry[] = data.entries.map((item) => {
    const e = (item ?? {}) as Partial<SavedEntry>;
    const file = asString(e.file);
    const absolute = asString(e.absolutePath);

    // 1. Relative to the show file (works after copying the show folder to another computer or OS).
    // 2. The absolute path from when it was saved (same computer).
    // 3. A file with the same name somewhere below the show's folder (the folder was reorganised).
    const candidates = [file && resolveStored(baseDir, file), absolute && path.normalize(absolute)].filter(Boolean) as string[];
    let found: string | null = null;
    for (const c of candidates) found ??= existingPath(c);
    if (!found && showPath) {
      showFolderIndex ??= buildAudioIndex(baseDir);
      found = uniqueMatch(showFolderIndex, baseNameAny(file || absolute));
    }

    const resolved = found ?? candidates[0] ?? '';
    if (!found) missing.push(resolved);
    return {
      id: randomUUID(),
      path: resolved,
      cueNumber: asString(e.cueNumber),
      cueText: asString(e.cueText),
      comment: asString(e.comment),
      volumeDb: asNumber(e.volumeDb, 0, -60, 12),
    };
  });

  const s = (data.settings ?? {}) as Partial<ShowSettings>;
  const settings: ShowSettings = {
    autoAdvanceOnStop: asBoolean(s.autoAdvanceOnStop, DEFAULT_SETTINGS.autoAdvanceOnStop),
    autoAdvanceOnEnd: asBoolean(s.autoAdvanceOnEnd, DEFAULT_SETTINGS.autoAdvanceOnEnd),
    stopFadeSeconds: asNumber(s.stopFadeSeconds, DEFAULT_SETTINGS.stopFadeSeconds, 0, 30),
  };
  const selectedIndex = entries.length ? Math.round(asNumber(data.selectedIndex, 0, 0, entries.length - 1)) : -1;

  return { state: { settings, entries, selectedIndex }, missing };
}

/**
 * The user located `oldPath` at `newPath`. Find where the other missing files
 * have most likely moved, using (in order):
 *  1. The same move of the folder structure, e.g. C:\Show\audio\a.wav -> /Volumes/USB/Show/audio/a.wav
 *     means C:\Show\sfx\b.wav -> /Volumes/USB/Show/sfx/b.wav
 *  2. The same file name in the folder of the located file
 *  3. A single file with the same name anywhere below that folder
 * Only files that exist are returned (old path -> new path).
 */
export function findRelinks(oldPath: string, newPath: string, otherMissing: string[]): Record<string, string> {
  const oldParts = splitAnyPath(oldPath);
  const newParts = splitAnyPath(newPath);

  // How many trailing path parts are the same (at least the file itself)?
  let common = 0;
  while (
    common < oldParts.length - 1 &&
    common < newParts.length - 1 &&
    nameKey(oldParts[oldParts.length - 1 - common]!) === nameKey(newParts[newParts.length - 1 - common]!)
  ) {
    common++;
  }
  const strip = Math.max(1, common);
  const oldRoot = oldParts.slice(0, oldParts.length - strip).map(nameKey);
  let newRoot = newPath;
  for (let i = 0; i < strip; i++) newRoot = path.dirname(newRoot);
  const newDir = path.dirname(newPath);

  let index: Map<string, string[]> | null = null;
  const result: Record<string, string> = {};
  for (const other of otherMissing) {
    if (other === oldPath) continue;
    const parts = splitAnyPath(other);
    const name = parts.at(-1) ?? '';
    let found: string | null = null;

    if (parts.length > oldRoot.length && oldRoot.every((p, i) => nameKey(parts[i]!) === p)) {
      found = existingPath(path.join(newRoot, ...parts.slice(oldRoot.length)));
    }
    found ??= existingPath(path.join(newDir, name));
    if (!found) {
      index ??= buildAudioIndex(newDir);
      found = uniqueMatch(index, name);
    }
    if (found) result[other] = found;
  }
  return result;
}

/** Writes JSON via a temp file and rename, so a crash never leaves a half-written file. */
export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tmp, filePath);
}

export function writeJsonAtomicSync(filePath: string, data: unknown): void {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/** Turns dropped files and folders into audio files (folders are searched recursively). */
export async function expandPaths(paths: string[]): Promise<ExpandedPaths> {
  const audio: string[] = [];
  const shows: string[] = [];
  let ignored = 0;

  for (const p of paths) {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(p);
    } catch {
      ignored++;
      continue;
    }
    if (stat.isDirectory()) {
      const children = (await fs.promises.readdir(p, { recursive: true })) as string[];
      const files = children.filter((c) => !splitAnyPath(c).some((part) => part.startsWith('.')));
      audio.push(...naturalSort(files.map((c) => path.join(p, c)).filter(isAudioPath)));
    } else if (isAudioPath(p)) {
      audio.push(p);
    } else if (isShowPath(p)) {
      shows.push(p);
    } else if (!isHidden(p)) {
      ignored++;
    }
  }

  return { audio, shows, ignored };
}
