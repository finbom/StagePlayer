import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuCommand, MenuState } from '../shared/types';
import type { Prefs, ThemeSetting } from './prefs';
import { DEFAULT_SETTINGS } from './showFile';

export const FADE_OPTIONS = [0, 0.5, 1, 2, 3, 5];

const isMac = process.platform === 'darwin';

export interface MenuContext {
  prefs: Prefs;
  state: MenuState | null;
  isDev: boolean;
  send(command: MenuCommand): void;
  clearRecent(): void;
  setTheme(theme: ThemeSetting): void;
  setKeepAwake(on: boolean): void;
  showShortcuts(): void;
  showAbout(): void;
}

/** Windows menus use "&" for keyboard mnemonics; macOS menus have none. */
const label = (text: string) => (isMac ? text.replace(/&(?!&)/g, '') : text);

/**
 * Keys like Space, Esc and the arrows are only *shown* in the menu
 * (registerAccelerator: false). The renderer handles them itself so they
 * keep working normally while typing in a text field.
 */
const shown = (accelerator: string) => ({ accelerator, registerAccelerator: false });

export function buildMenu(ctx: MenuContext): Menu {
  const { send } = ctx;
  const settings = ctx.state?.settings ?? DEFAULT_SETTINGS;
  const can = (key: keyof Omit<MenuState, 'settings'>) => ctx.state?.[key] ?? false;

  const recent: MenuItemConstructorOptions[] = ctx.prefs.recentFiles.length
    ? [
        ...ctx.prefs.recentFiles.map((file, i) => ({
          label: isMac ? file : `&${i + 1}  ${file.replace(/&/g, '&&')}`,
          click: () => send({ type: 'openRecent', path: file }),
        })),
        { type: 'separator' as const },
        { label: label('&Clear Recent List'), click: ctx.clearRecent },
      ]
    : [{ label: 'No recent shows', enabled: false }];

  const themeItem = (theme: ThemeSetting, text: string): MenuItemConstructorOptions => ({
    label: label(text),
    type: 'radio',
    checked: ctx.prefs.theme === theme,
    click: () => ctx.setTheme(theme),
  });

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
      ]
    : [];

  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: label('&File'),
      submenu: [
        { label: label('&New Show'), accelerator: 'CmdOrCtrl+N', click: () => send({ type: 'new' }) },
        { label: label('&Open Show…'), accelerator: 'CmdOrCtrl+O', click: () => send({ type: 'open' }) },
        { label: label('Open &Recent'), submenu: recent },
        { type: 'separator' },
        { label: label('&Save'), accelerator: 'CmdOrCtrl+S', click: () => send({ type: 'save' }) },
        { label: label('Save &As…'), accelerator: 'CmdOrCtrl+Shift+S', click: () => send({ type: 'saveAs' }) },
        { type: 'separator' },
        { label: label('&Import Audio Files…'), accelerator: 'CmdOrCtrl+I', click: () => send({ type: 'import' }) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { label: 'E&xit', role: 'quit' },
      ],
    },
    {
      label: label('&Edit'),
      submenu: [
        { id: 'undo', label: label('&Undo'), accelerator: 'CmdOrCtrl+Z', enabled: can('canUndo'), click: () => send({ type: 'undo' }) },
        {
          id: 'redo',
          label: label('&Redo'),
          accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
          enabled: can('canRedo'),
          click: () => send({ type: 'redo' }),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'selectAll' } as MenuItemConstructorOptions] : []),
        { type: 'separator' },
        {
          id: 'edit',
          label: label('&Edit Cue and Comment'),
          ...shown(isMac ? 'Enter' : 'F2'),
          enabled: can('hasSelection'),
          click: () => send({ type: 'edit' }),
        },
        { id: 'duplicate', label: label('&Duplicate Entry'), accelerator: 'CmdOrCtrl+D', enabled: can('hasSelection'), click: () => send({ type: 'duplicate' }) },
        {
          id: 'remove',
          label: label('Re&move Entry'),
          ...shown(isMac ? 'Backspace' : 'Delete'),
          enabled: can('hasSelection'),
          click: () => send({ type: 'remove' }),
        },
        { type: 'separator' },
        { id: 'moveUp', label: label('Move Entry &Up'), accelerator: 'CmdOrCtrl+Up', enabled: can('canMoveUp'), click: () => send({ type: 'moveUp' }) },
        { id: 'moveDown', label: label('Move Entry Do&wn'), accelerator: 'CmdOrCtrl+Down', enabled: can('canMoveDown'), click: () => send({ type: 'moveDown' }) },
      ],
    },
    {
      label: label('&Playback'),
      submenu: [
        { label: label('&Play / Pause'), ...shown('Space'), click: () => send({ type: 'playPause' }) },
        { label: label('&Stop'), ...shown('Esc'), click: () => send({ type: 'stop' }) },
        { label: label('Stop &All Immediately'), ...shown('Shift+Esc'), click: () => send({ type: 'panic' }) },
        { label: label('&Next Entry'), ...shown('Down'), click: () => send({ type: 'next' }) },
        { type: 'separator' },
        { label: label('&Back 5 Seconds'), ...shown('Left'), click: () => send({ type: 'seekBack' }) },
        { label: label('&Forward 5 Seconds'), ...shown('Right'), click: () => send({ type: 'seekForward' }) },
        { type: 'separator' },
        {
          id: 'autoAdvanceOnStop',
          label: label('Auto-Advance on S&top'),
          type: 'checkbox',
          checked: settings.autoAdvanceOnStop,
          click: (item) => send({ type: 'setAutoAdvanceOnStop', value: item.checked }),
        },
        {
          id: 'autoAdvanceOnEnd',
          label: label('Auto-Advance on Entry &End'),
          type: 'checkbox',
          checked: settings.autoAdvanceOnEnd,
          click: (item) => send({ type: 'setAutoAdvanceOnEnd', value: item.checked }),
        },
        {
          label: label('Stop Fade &Time'),
          submenu: FADE_OPTIONS.map((seconds) => ({
            id: `fade-${seconds}`,
            label: seconds === 0 ? 'No Fade (Cut)' : `${seconds} Second${seconds === 1 ? '' : 's'}`,
            type: 'radio' as const,
            checked: settings.stopFadeSeconds === seconds,
            click: () => send({ type: 'setStopFade', value: seconds }),
          })),
        },
        { type: 'separator' },
        {
          label: label('&Keep Computer Awake'),
          type: 'checkbox',
          checked: ctx.prefs.keepAwake,
          click: (item) => ctx.setKeepAwake(item.checked),
        },
      ],
    },
    {
      label: label('&View'),
      submenu: [
        {
          label: label('&Theme'),
          submenu: [themeItem('system', 'Use &System Setting'), themeItem('light', '&Light'), themeItem('dark', '&Dark')],
        },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(ctx.isDev
          ? ([{ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    ...(isMac ? [{ role: 'windowMenu' } as MenuItemConstructorOptions] : []),
    {
      label: label('&Help'),
      role: 'help',
      submenu: [
        { label: label('&Keyboard Shortcuts'), accelerator: isMac ? 'Cmd+/' : 'F1', click: ctx.showShortcuts },
        ...(isMac
          ? []
          : ([{ type: 'separator' }, { label: '&About StagePlayer', click: ctx.showAbout }] as MenuItemConstructorOptions[])),
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

/** Updates enabled/checked states in place, without rebuilding the menu. */
export function applyMenuState(menu: Menu | null, state: MenuState): void {
  if (!menu) return;
  const set = (id: string, props: { enabled?: boolean; checked?: boolean }) => {
    const item = menu.getMenuItemById(id);
    if (item) Object.assign(item, props);
  };
  set('undo', { enabled: state.canUndo });
  set('redo', { enabled: state.canRedo });
  set('edit', { enabled: state.hasSelection });
  set('duplicate', { enabled: state.hasSelection });
  set('remove', { enabled: state.hasSelection });
  set('moveUp', { enabled: state.canMoveUp });
  set('moveDown', { enabled: state.canMoveDown });
  set('autoAdvanceOnStop', { checked: state.settings.autoAdvanceOnStop });
  set('autoAdvanceOnEnd', { checked: state.settings.autoAdvanceOnEnd });
  for (const seconds of FADE_OPTIONS) set(`fade-${seconds}`, { checked: state.settings.stopFadeSeconds === seconds });
}
