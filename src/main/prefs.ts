import { app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeJsonAtomicSync } from './showFile';

export type ThemeSetting = 'system' | 'light' | 'dark';

/** App-wide preferences (not part of a show file). */
export interface Prefs {
  theme: ThemeSetting;
  keepAwake: boolean;
  recentFiles: string[];
  lastDirectory: string | null;
  windowBounds: { x: number; y: number; width: number; height: number; maximized: boolean } | null;
}

const DEFAULTS: Prefs = {
  theme: 'system',
  keepAwake: true,
  recentFiles: [],
  lastDirectory: null,
  windowBounds: null,
};

const prefsPath = () => path.join(app.getPath('userData'), 'prefs.json');

export function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath(), 'utf8')) as Partial<Prefs>;
    return {
      theme: raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : 'system',
      keepAwake: typeof raw.keepAwake === 'boolean' ? raw.keepAwake : DEFAULTS.keepAwake,
      recentFiles: Array.isArray(raw.recentFiles) ? raw.recentFiles.filter((f) => typeof f === 'string').slice(0, 10) : [],
      lastDirectory: typeof raw.lastDirectory === 'string' ? raw.lastDirectory : null,
      windowBounds: raw.windowBounds && typeof raw.windowBounds.width === 'number' ? raw.windowBounds : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    writeJsonAtomicSync(prefsPath(), prefs);
  } catch (err) {
    console.error('Could not save preferences', err);
  }
}
