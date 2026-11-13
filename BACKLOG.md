# StagePlayer backlog

Ideas that were discussed and deliberately left out of version 1, plus known follow-ups.
Roughly ordered by expected value for rehearsals within each section.

## Next phase

- **macOS version** — build and test on a Mac. Mac menu conventions (app menu, ⌘ shortcuts,
  "About" and "Quit" in the app menu), `.dmg` packaging, universal binary (Apple Silicon + Intel).
  Decide whether to pay for Apple notarization (Apple Developer account, $99/year) or document the
  right-click → Open workaround. The macOS icon (`stageplayer-brand/desktop/icon.icns`) is already
  configured.
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

- **Code signing (Windows)** — removes the SmartScreen "Windows protected your PC" warning.
  Requires a code signing certificate.
- **Auto-update from GitHub Releases** (electron-updater).
- **Windows on ARM build** (arm64) if anyone rehearses on such a laptop.
- **Smaller app** — Tauri was considered; Electron was chosen for identical audio behaviour on
  Windows and macOS.

## Housekeeping

- Automated tests for the playback logic and the UI (today: round-trip test of the show file
  format and manual / scripted smoke tests).
- Choose a licence for the GitHub repository (package.json says `UNLICENSED` for now).
