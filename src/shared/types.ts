// Types shared between the main process, the preload bridge and the renderer.
// Only type declarations live here, so nothing from this file exists at runtime.

export interface ShowSettings {
  /** After Stop, select the entry following the stopped one. */
  autoAdvanceOnStop: boolean;
  /** When an entry plays to its end, select the entry following it. */
  autoAdvanceOnEnd: boolean;
  /** Fade-out time used by Stop, in seconds (0 = cut). */
  stopFadeSeconds: number;
}

export interface Entry {
  /** Runtime id, regenerated when a show is opened. */
  id: string;
  /** Absolute path of the audio file at runtime. */
  path: string;
  cueNumber: string;
  cueText: string;
  comment: string;
  volumeDb: number;
}

export interface ShowState {
  settings: ShowSettings;
  entries: Entry[];
  selectedIndex: number;
}

export interface LoadedShow {
  filePath: string | null;
  state: ShowState;
  /** Absolute paths that could not be found on disk. */
  missing: string[];
  /** True when the show came from crash recovery (it then counts as unsaved). */
  restored: boolean;
}

export interface ExpandedPaths {
  audio: string[];
  shows: string[];
  ignored: number;
}

export interface LocateResult {
  /** Old path -> new path. */
  relinked: Record<string, string>;
}

export interface MenuState {
  settings: ShowSettings;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export type MenuCommand =
  | {
      type:
        | 'new'
        | 'open'
        | 'save'
        | 'saveAs'
        | 'saveAndClose'
        | 'import'
        | 'undo'
        | 'redo'
        | 'edit'
        | 'remove'
        | 'duplicate'
        | 'moveUp'
        | 'moveDown'
        | 'playPause'
        | 'stop'
        | 'panic'
        | 'next'
        | 'seekBack'
        | 'seekForward';
    }
  | { type: 'openRecent'; path: string }
  | { type: 'setAutoAdvanceOnStop' | 'setAutoAdvanceOnEnd'; value: boolean }
  | { type: 'setStopFade'; value: number };

export type DiscardChoice = 'save' | 'discard' | 'cancel';

export interface RecoveryData {
  state: ShowState;
  filePath: string | null;
}

/** The API the preload script exposes to the renderer as `window.stagePlayer`. */
export interface StagePlayerApi {
  onMenuCommand(callback: (command: MenuCommand) => void): void;
  getStartupShow(): Promise<LoadedShow | null>;
  openShowDialog(): Promise<LoadedShow | null>;
  openShowFile(filePath: string): Promise<LoadedShow | null>;
  /** Saves to `filePath`, or asks for a location when it is null. Returns the saved path or null. */
  saveShow(state: ShowState, filePath: string | null): Promise<string | null>;
  importAudioDialog(): Promise<string[]>;
  expandPaths(paths: string[]): Promise<ExpandedPaths>;
  getPathForFile(file: File): string;
  readAudioFile(filePath: string): Promise<Uint8Array>;
  checkFiles(paths: string[]): Promise<boolean[]>;
  locateFile(missingPath: string, otherMissing: string[]): Promise<LocateResult | null>;
  confirmDiscard(): Promise<DiscardChoice>;
  setDocumentState(state: { filePath: string | null; dirty: boolean }): void;
  updateMenuState(state: MenuState): void;
  writeRecovery(data: RecoveryData | null): void;
  closeWindow(): void;
}
