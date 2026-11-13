# StagePlayer — logo & icon assets (Concept B, Spotlight)

## Colours
| Name | Hex | Use |
|---|---|---|
| Stage Ink | `#17131D` | Dark backgrounds, text on light |
| Icon Plum | `#241C2E` | Icon background |
| Curtain Red | `#B0303F` | Curtains |
| Spotlight Gold | `#F2B33D` | Spotlight / accent |
| Paper | `#F6F1E7` | Light backgrounds |

Font: **Archivo** (width 112, "Stage" ExtraBold 800 + "Player" Regular 400). In the SVGs the wordmark is outlined, so no font is needed.

## Folders
- `svg/` — vector masters. `icon.svg` (rounded), `icon-square.svg` (full bleed), `icon-small.svg` (simplified for ≤32 px), `mark.svg` (transparent, no background), lockups and wordmark for light/dark backgrounds, Android adaptive layers.
- `logo/` — PNG lockups @1x/2x/3x + mark PNGs.
- `web/` — favicon.ico/svg/16/32, apple-touch-icon (180), PWA icons 192/512 + maskable, `site.webmanifest`.
- `ios/` — full-bleed square icons without transparency (iOS rounds the corners). Drop `icon-1024.png` into the AppIcon set in Xcode.
- `android/` — `mipmap-*` folders, ready to copy into `res/` (legacy + adaptive foreground/background/monochrome) and `play-store-512.png`.
- `desktop/` — PNG 16–1024, `icon.ico` (Windows), `icon.icns` (macOS).

## Web — `<head>`
```html
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#17131D">
```

## Rules
- At 32 px and smaller, use `icon-small` (valance + spotlight only); the curtains get muddy.
- Keep clear space around the logo of at least ¼ of the icon height.
- Use `-on-light` on light backgrounds and `-on-dark` on dark ones.
