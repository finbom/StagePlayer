<p align="center">
  <img src="stageplayer-brand/logo/logo-horizontal-on-light@2x.png#gh-light-mode-only" alt="StagePlayer" width="420">
  <img src="stageplayer-brand/logo/logo-horizontal-on-dark@2x.png#gh-dark-mode-only" alt="StagePlayer" width="420">
</p>

<p align="center">
  <b>A simple music and sound player for musical theatre rehearsals.</b><br>
  Windows&nbsp;·&nbsp;macOS (Apple Silicon)&nbsp;·&nbsp;
  <a href="https://github.com/finbom/StagePlayer/releases/latest">Download</a>
</p>

# StagePlayer

Build a playlist of MP3 and WAV files, add a cue and a note to each one, and run the whole show with
the **Space** bar.

| Platform | Supported | Download |
| --- | --- | --- |
| **Windows** 10 and 11 (64-bit) | ✅ | Installer or portable `.exe` |
| **macOS** on Apple Silicon (M1 or newer) | ✅ | `.dmg` |
| macOS on Intel | ❌ | — |

The same show file works on both Windows and macOS. Copy the show folder between computers and
carry on rehearsing.

## Download and install

Get the latest version from the [**Releases**](https://github.com/finbom/StagePlayer/releases/latest) page.

| File | For |
| --- | --- |
| `StagePlayer-Setup-x.y.z.exe` | Windows: installer (no administrator rights needed) |
| `StagePlayer-x.y.z-Portable.exe` | Windows: runs without installing, e.g. from a USB stick |
| `StagePlayer-x.y.z-mac-arm64.dmg` | macOS on Apple Silicon (M1 or newer) |
| `SHA256SUMS.txt` | Checksums to [verify the download](#verify-the-download-optional) |

> **Why do I get a warning?** StagePlayer is free, open-source software and its files are not (yet)
> signed by a certificate that Windows and macOS recognise (see
> [Code signing policy](#code-signing-policy)). The warning means "unknown publisher", not that
> something is wrong. You only need to confirm it the first time you start a new version.

### Windows

1. Download `StagePlayer-Setup-x.y.z.exe` (or the portable version) and double-click it.
2. A blue window says **"Windows protected your PC"**.
3. Click **More info** (the small link under the text).
4. Click **Run anyway**.

**There is no "Run anyway" button?** Close the window, right-click the downloaded file, choose
**Properties**, tick **Unblock** at the bottom of the **General** tab, click **OK** and start it again.

**Windows 11 says "Smart App Control blocked an app"?** Smart App Control does not allow unsigned
programs and has no "run anyway". Wait for a signed version of StagePlayer, or ask whoever manages
the computer.

### macOS

macOS on Apple Silicon only runs signed apps. The StagePlayer app is ad-hoc signed (signed, but not
by a developer registered with Apple), so macOS asks you to confirm it once.

1. Open `StagePlayer-x.y.z-mac-arm64.dmg` and drag **StagePlayer** to **Applications**.
2. Open **StagePlayer** from Applications. macOS says **"StagePlayer" Not Opened** (Apple could not
   verify it). Click **Done**. Do *not* click Move to Trash.
3. Open **System Settings → Privacy & Security** and scroll down to **Security**. Next to the message
   about StagePlayer, click **Open Anyway**, then confirm with your password or Touch ID.
4. StagePlayer starts. From now on it opens normally.

**Alternative, using Terminal** (also fixes the message *"StagePlayer is damaged and can't be
opened"*). This removes the "downloaded from the internet" mark from the app:

```sh
xattr -dr com.apple.quarantine /Applications/StagePlayer.app
```

### Verify the download (optional)

Each release includes `SHA256SUMS.txt` with a checksum for every file. If the checksum of your
download matches, the file is exactly the one that GitHub Actions built from this repository.

Windows (PowerShell):

```powershell
Get-FileHash "$env:USERPROFILE\Downloads\StagePlayer-Setup-0.2.0.exe" -Algorithm SHA256
```

macOS (Terminal):

```sh
shasum -a 256 ~/Downloads/StagePlayer-0.2.0-mac-arm64.dmg
```

Compare the result with the line for that file in `SHA256SUMS.txt` (upper or lower case does not
matter).

## Running a rehearsal

| Key | Action |
| --- | --- |
| **Space** | Play the selected entry. If it is already playing: pause. Paused: resume. |
| **Esc** | Stop. Cuts immediately by default; a fade-out can be chosen in Playback › Stop Fade Time. During a fade, press again to silence everything immediately (also **Shift+Esc**). |
| **↓ / ↑** | Select the next / previous entry (the **Next** button does the same as ↓). |
| **← / →** | Back / forward 5 seconds. With nothing playing, this cues the selected entry at that point. |
| **F2** or **Enter** (Mac: **Return**) | Edit the cue and comment of the selected entry. **Esc** leaves the text field. |

On a Mac, use **⌘** wherever this README says **Ctrl**, and **⌫** to remove an entry.
**Help › Keyboard Shortcuts** lists every shortcut for your system.

With the two default options in the **Playback** menu:

- **Auto-Advance on Entry End** — when an entry plays to the end, the next one is selected.
- **Auto-Advance on Stop** — when you stop an entry, the next one is selected.

So a whole show runs with just Space (and Esc to cut a track early). If you have already selected
another entry yourself, StagePlayer leaves your selection alone.

Starting a new entry while another is playing stops the old one, using the same Stop Fade Time
(cut by default).

## Building the playlist

- Drag MP3/WAV files or whole folders from Explorer or Finder onto the window. A blue line shows where they will
  be inserted. Use **File › Import Audio Files…** (Ctrl+I) as an alternative.
- Reorder by dragging rows, with **Move Up / Move Down** on the toolbar, or with **Ctrl+↑ / Ctrl+↓**.
- Each entry has a **Cue** (e.g. Q12), **Cue text** (when to play it, e.g. a line from the script), a
  free **Comment** and a **Volume** adjustment.
- **Undo / Redo** with Ctrl+Z / Ctrl+Y.

## Show files

Shows are saved as `.stageshow` files (readable JSON). A show file contains everything needed to
restore the show: the playlist order, cues, cue texts, comments, volumes, the auto-advance and fade
settings, and the selected entry.

Audio files are stored **relative to the show file**. Keep the audio in the same folder as the show
(or a subfolder) and you can copy the whole folder to another computer, also **between Windows and
macOS**. File names with å, ä, ö and other accented letters work on both.

When a show is opened and a file is not where it used to be, StagePlayer looks for a file with the
same name in the show's folder and its subfolders.

If a file still can't be found, its entry turns red. Select it and click **Locate File…**.
StagePlayer then works out where the other missing files have most likely moved, for example to
the same folder structure on a USB stick, and asks once whether to update all those links too.

If the app is closed unexpectedly with unsaved changes, it offers to restore them the next time it
starts.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm start           # build and run
npm run typecheck
npm test            # show file format, cross-platform paths, relinking
npm run smoke       # starts the app and drives it (after npm run build)
npm run dist:win    # Windows: installer + portable .exe in release/
npm run dist:mac    # macOS (on a Mac): .dmg for Apple Silicon in release/
```

Project layout:

```
src/main/       Electron main process: window, menu, dialogs, show files, crash recovery
src/preload/    The small, explicit bridge between the UI and the main process
src/renderer/   The UI (plain TypeScript + HTML/CSS) and the audio engine (Web Audio API)
src/shared/     Types shared by all of the above
stageplayer-brand/  Logo and icon assets (see its README); the build copies what the app needs
```

GitHub Actions builds, tests and smoke-tests the app on Windows and on an Apple Silicon Mac for every
push. The smoke test screenshots are attached to each run. To publish a release, push a tag such as
`v0.2.0`. The workflow then attaches the Windows and Mac files to a draft release.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).

Windows releases are built from this repository by GitHub Actions and signed through SignPath.
Every signing request is approved manually. (Code signing is being set up; releases published
before approval are unsigned.)

Team roles:

- Committers and reviewers: [finbom](https://github.com/finbom)
- Approvers: [finbom](https://github.com/finbom)

Contributions from anyone else (pull requests) are reviewed by a committer before they are merged.

## Privacy

This program will not transfer any information to other networked systems unless specifically
requested by the user or the person installing or operating it.

StagePlayer makes no network connections. Shows, settings and recently used files are stored
only on your own computer.

## License

[MIT](LICENSE), covering both the source code and the logo and icon files in `stageplayer-brand/`.
