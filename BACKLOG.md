# StagePlayer backlog

Ideas that were discussed and deliberately left out of version 1, plus known follow-ups.
Roughly ordered by expected value for rehearsals within each section.

## Next phase

- **macOS: test on a real Mac** — the first Mac version (Apple Silicon only) is built and
  smoke-tested in GitHub Actions; still to verify by hand: drag and drop from Finder, sound output,
  menus, the "Open Anyway" first-launch flow.
- **macOS: notarization** — removes the "cannot verify" warning. Requires the Apple Developer
  Program ($99/year).
- **macOS: Intel Macs** — not supported (decision: Apple Silicon only). Could be added as a
  universal build.
- **macOS: open a show from Finder** by dropping it on the Dock icon (`open-file` event; today a show
  can be dropped onto the window).
- **Brand font** — the UI uses Segoe UI; the brand font Archivo could be bundled for headings.

## Playback

- **Back / forward 5 s buttons** in the transport (the ← / → keys already do this).
- **Now / Next display** — show "Next up" in large text next to what is playing.
- **Trim start / end per entry** — skip silence at the start or end of a file.
- **Fade in / fade out per entry** — today there is only a global Stop fade.
- **Loop an entry or a section** — for underscore music and vamps.
- **Choose output device** — e.g. send audio to a USB interface instead of the laptop speakers.
- **Change tempo without changing pitch** — for practising songs slower.
- **Waveform display** in the progress bar, to see where the music changes.
- **Overlapping playback** — start the next entry while the previous one keeps playing
  (today the previous one fades out).

## Playlist and show file

- **Package show…** — copy the show file and all its audio into one folder (or zip) to hand to
  someone else.
- **Open shows by double-clicking** in Explorer / Finder (file association; needs registration
  by the installer).
- **Select several entries at once** — to move, remove or duplicate them together.
- **Colour tags per entry** — e.g. by act or scene.
- **Export / print the cue sheet** (PDF or CSV) for the stage manager.
- **Show mode lock** — prevents accidental editing during a run-through.
- **Remember undo history across saves/opens** (today it resets when a show is opened).
- **Search / filter** the playlist by cue or text.

## Distribution

- **Code signing (Windows) via SignPath Foundation** (free for open source). Steps:
  1. ~~MIT licence, code signing policy and privacy statement in the README~~ (done)
  2. ~~Make the repository public~~ (done)
  3. ~~Publish v0.1.0 unsigned~~ (done)
  4. ~~Apply at https://signpath.org/apply~~ (done, waiting for reply)
  5. After approval: add the SignPath signing step to `.github/workflows/build.yml`
- **Auto-update from GitHub Releases** (electron-updater).
- **Windows on ARM build** (arm64) if anyone rehearses on such a laptop.
- **Smaller app** — Tauri was considered; Electron was chosen for identical audio behaviour on
  Windows and macOS.

## Housekeeping

- More automated UI tests (today: show file / cross-platform / relink tests and a smoke test that
  drives the packaged app on Windows and macOS in CI). Not covered yet: save/open dialogs, menu
  shortcuts, drag and drop.
