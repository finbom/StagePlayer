// Copies non-TypeScript files into dist/: the renderer's HTML/CSS, and the brand assets the app uses.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const copy = (from, to) => {
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(from, to);
};

// Renderer HTML and CSS
for (const file of readdirSync('src/renderer')) {
  if (!file.endsWith('.ts')) copy(join('src/renderer', file), join('dist/renderer', file));
}

// Brand assets (source of truth: stageplayer-brand/)
const brand = 'stageplayer-brand';
copy(join(brand, 'desktop/icon.ico'), 'dist/assets/icon.ico'); // window / taskbar icon
copy(join(brand, 'desktop/icon-256.png'), 'dist/assets/icon-256.png'); // About dialog
copy(join(brand, 'svg/logo-stacked-on-light.svg'), 'dist/renderer/brand/logo-stacked-on-light.svg');
copy(join(brand, 'svg/logo-stacked-on-dark.svg'), 'dist/renderer/brand/logo-stacked-on-dark.svg');
