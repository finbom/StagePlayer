# StagePlayer

A very simple music and sound player for musical theatre rehearsals. Build a playlist of MP3 and WAV
files, add a cue and a note to each one, and run the whole show with the **Space** bar.

Windows is supported now; macOS will follow (see [BACKLOG.md](BACKLOG.md)).

## Download

Get the latest version from the repository's **Releases** page:

- `StagePlayer-Setup-x.y.z.exe` — installer (no administrator rights needed)
- `StagePlayer-x.y.z-Portable.exe` — runs without installing, e.g. from a USB stick

The app is not code-signed yet, so Windows may show **"Windows protected your PC"**. Click
**More info → Run anyway**.

## Running a rehearsal

| Key | Action |
| --- | --- |
| **Space** | Play the selected entry. If it is already playing: pause. Paused: resume. |
| **Esc** | Stop with a fade-out. Press again to silence everything immediately (also **Shift+Esc**). |
| **↓ / ↑** | Select the next / previous entry (the **Next** button does the same as ↓). |
| **← / →** | Back / forward 5 seconds. With nothing playing, this cues the selected entry at that point. |
| **F2** or **Enter** | Edit the cue and comment of the selected entry. **Esc** leaves the text field. |

With the two default options in the **Playback** menu:

- **Auto-Advance on Entry End** — when an entry plays to the end, the next one is selected.
- **Auto-Advance on Stop** — when you stop an entry, the next one is selected.

So a whole show runs with just Space (and Esc to cut a track early). If you have already selected
another entry yourself, StagePlayer leaves your selection alone.

Starting a new entry while another is playing fades the old one out (Playback › Stop Fade Time).

## Building the playlist

- Drag MP3/WAV files or whole folders from Explorer onto the window. A blue line shows where they will
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
(or a subfolder) and you can copy the whole folder to another computer. If a file can't be found,
its entry turns red. Select it and click **Locate File…**. Other missing files in the same folder are
relinked in one go.

If the app is closed unexpectedly with unsaved changes, it offers to restore them the next time it
starts.

## Development

Requires Node.js 22 or newer.

```sh
npm install
npm start           # build and run
npm run typecheck
npm run dist:win    # installer + portable .exe in release/
```

Project layout:

```
src/main/       Electron main process: window, menu, dialogs, show files, crash recovery
src/preload/    The small, explicit bridge between the UI and the main process
src/renderer/   The UI (plain TypeScript + HTML/CSS) and the audio engine (Web Audio API)
src/shared/     Types shared by all of the above
stageplayer-brand/  Logo and icon assets (see its README); the build copies what the app needs
```

To publish a release, push a tag such as `v0.1.0`. The GitHub Actions workflow builds the Windows
files and attaches them to a draft release.
