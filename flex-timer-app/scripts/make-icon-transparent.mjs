/**
 * One-off script: make black background transparent in icon.
 * Run from repo root: node scripts/make-icon-transparent.mjs
 */
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

async function main() {
  const sharp = (await import('sharp')).default;
  const iconPath = path.join(root, 'src', 'app', 'icon.png');
  // Only write to src/app/icon.png; avoid public/icon.png to prevent Next.js conflict with app metadata route /icon.png

  const img = sharp(iconPath);
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const threshold = 60;
  const channels = info.channels;

  for (let i = 0; i < data.length; i += channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r <= threshold && g <= threshold && b <= threshold) {
      data[i + 3] = 0; // alpha
    }
  }

  await sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4,
    },
  })
    .png()
    .toFile(iconPath);

  console.log('Written:', iconPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

