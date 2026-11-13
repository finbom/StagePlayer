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
  stopFadeSeconds: 2,
};

/** One playlist entry as stored in a .stageshow file. */
interface SavedEntry {
  /** Path relative to the show file (forward slashes), or absolute if on another drive. */
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

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalSort = (paths: string[]) => [...paths].sort((a, b) => collator.compare(a, b));

const extensionOf = (p: string) => path.extname(p).slice(1).toLowerCase();
export const isAudioPath = (p: string) => AUDIO_EXTENSIONS.includes(extensionOf(p));
export const isShowPath = (p: string) => extensionOf(p) === SHOW_EXTENSION;

function toPortablePath(filePath: string, baseDir: string | null): string {
  if (!baseDir) return filePath;
  const rel = path.relative(baseDir, filePath);
  // On Windows a file on another drive cannot be relative; keep it absolute.
  if (!rel || path.isAbsolute(rel)) return filePath;
  return rel.split(path.sep).join('/');
}

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
      absolutePath: e.path,
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

export function deserializeShow(raw: unknown, showPath: string | null): { state: ShowState; missing: string[] } {
  const data = (raw ?? {}) as Partial<SavedShow>;
  if (data.format !== FORMAT || !Array.isArray(data.entries)) {
    throw new Error('The file is not a StagePlayer show.');
  }
  if (typeof data.formatVersion === 'number' && data.formatVersion > FORMAT_VERSION) {
    throw new Error('This show was saved by a newer version of StagePlayer. Please update the app to open it.');
  }

  const baseDir = showPath ? path.dirname(showPath) : process.cwd();
  const missing: string[] = [];
  const entries: Entry[] = data.entries.map((item) => {
    const e = (item ?? {}) as Partial<SavedEntry>;
    const candidates: string[] = [];
    if (asString(e.file)) candidates.push(path.resolve(baseDir, asString(e.file)));
    if (asString(e.absolutePath)) candidates.push(path.normalize(asString(e.absolutePath)));
    const found = candidates.find((c) => fs.existsSync(c));
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
      audio.push(...naturalSort(children.map((c) => path.join(p, c)).filter(isAudioPath)));
    } else if (isAudioPath(p)) {
      audio.push(p);
    } else if (isShowPath(p)) {
      shows.push(p);
    } else {
      ignored++;
    }
  }

  return { audio, shows, ignored };
}
