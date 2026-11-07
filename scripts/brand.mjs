#!/usr/bin/env node
// Builds every brand asset from brand/shapes.mjs:
//   brand/mark.svg, brand/mark-mono.svg    the masters
//   media/icon.png                          store icon (256 × 256)
//   media/activity.svg                      activity-bar icon: one flat path, any colour
//   media/glyphs.woff                       status-bar glyph ($(many-hats-logo)), U+E001
//   docs/images/social-preview.png          GitHub social preview (1280 × 640)
//   docs/images/header.png                  README header (1280 × 360)
// Needs rsvg-convert (brew install librsvg). Outputs are committed, so building the extension doesn't need it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import polygonClipping from 'polygon-clipping';
import { SVGIcons2SVGFontStream } from 'svgicons2svgfont';
import svg2ttf from 'svg2ttf';
import ttf2woff from 'ttf2woff';
import { CAP, COLORS, TOP_HAT_BAND, TOP_HAT_BRIM, TOP_HAT_CROWN, colorMark } from '../brand/shapes.mjs';

const root = path.resolve(import.meta.dirname, '..');
const out = (p) => path.join(root, p);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'many-hats-brand-'));

// ---------- paths → polygons ----------
/** Flatten an absolute SVG path (M L H V Q C Z) into rings of points. */
function flatten(d, steps = 24) {
  const tokens = d.match(/[MLHVQCZ]|-?\d*\.?\d+/gi);
  const rings = [];
  let ring = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      if (ring.length) rings.push(ring);
      x = num();
      y = num();
      ring = [[x, y]];
    } else if (cmd === 'L') {
      x = num();
      y = num();
      ring.push([x, y]);
    } else if (cmd === 'H') {
      x = num();
      ring.push([x, y]);
    } else if (cmd === 'V') {
      y = num();
      ring.push([x, y]);
    } else if (cmd === 'Q') {
      const [cx, cy, ex, ey] = [num(), num(), num(), num()];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        ring.push([u * u * x + 2 * u * t * cx + t * t * ex, u * u * y + 2 * u * t * cy + t * t * ey]);
      }
      [x, y] = [ex, ey];
    } else if (cmd === 'C') {
      const [c1x, c1y, c2x, c2y, ex, ey] = [num(), num(), num(), num(), num(), num()];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        ring.push([
          u ** 3 * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex,
          u ** 3 * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey,
        ]);
      }
      [x, y] = [ex, ey];
    } else if (cmd === 'Z' || cmd === 'z') {
      if (ring.length) {
        ring.push(ring[0]);
        rings.push(ring);
      }
      ring = [];
    } else {
      throw new Error(`unsupported path command ${cmd}`);
    }
  }
  if (ring.length) rings.push(ring);
  return rings.map((r) => [r]);
}

/** Approximate dilation by a disc: the union of the shape moved around a circle. */
function dilate(polys, r, n = 24) {
  const moved = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    moved.push(
      polys.map((poly) =>
        poly.map((ring) => ring.map(([px, py]) => [px + r * Math.cos(a), py + r * Math.sin(a)])),
      ),
    );
  }
  return polygonClipping.union(polys, ...moved);
}

const round = (v) => Math.round(v * 100) / 100;
const toPath = (multi) =>
  multi
    .map((poly) =>
      poly
        .map(
          (ring) =>
            `M${ring
              .slice(0, -1)
              .map(([px, py]) => `${round(px)},${round(py)}`)
              .join('L')}Z`,
        )
        .join(''),
    )
    .join('');

const crown = flatten(TOP_HAT_CROWN);
const brim = flatten(TOP_HAT_BRIM);
const band = flatten(TOP_HAT_BAND);
const cap = flatten(CAP);
// The mono mark: the top hat with its band cut out and a gap where the cap stands in front.
const topHat = polygonClipping.difference(
  polygonClipping.union(crown, brim),
  polygonClipping.intersection(band, [
    [
      [
        [40, 112],
        [150, 112],
        [150, 126],
        [40, 126],
        [40, 112],
      ],
    ],
  ]),
);
const mono = polygonClipping.union(polygonClipping.difference(topHat, dilate(cap, 11)), cap);
const monoPath = toPath(mono);

// ---------- masters and editor icons ----------
fs.mkdirSync(out('brand'), { recursive: true });
fs.mkdirSync(out('media'), { recursive: true });
fs.mkdirSync(out('docs/images'), { recursive: true });
fs.writeFileSync(out('brand/mark.svg'), colorMark());
const monoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="24" height="24"><path fill="currentColor" d="${monoPath}"/></svg>\n`;
fs.writeFileSync(out('brand/mark-mono.svg'), monoSvg);
fs.writeFileSync(out('media/activity.svg'), monoSvg);

function render(svg, file, width, height) {
  const src = path.join(tmp, `${path.basename(file)}.svg`);
  fs.writeFileSync(src, svg);
  execFileSync('rsvg-convert', ['-w', String(width), '-h', String(height ?? width), src, '-o', file]);
}
render(colorMark(), out('media/icon.png'), 256);

// ---------- status-bar glyph font ----------
async function buildFont() {
  const fontStream = new SVGIcons2SVGFontStream({
    fontName: 'many-hats',
    normalize: true,
    fontHeight: 1000,
    centerHorizontally: true,
    log: () => {},
  });
  const chunks = [];
  fontStream.on('data', (c) => chunks.push(Buffer.from(c)));
  const done = new Promise((resolve, reject) => {
    fontStream.on('end', resolve);
    fontStream.on('error', reject);
  });
  const glyph = Readable.from([monoSvg.replace('fill="currentColor"', '')]);
  glyph.metadata = { unicode: [''], name: 'many-hats-logo' };
  fontStream.write(glyph);
  fontStream.end();
  await done;
  const ttf = svg2ttf(Buffer.concat(chunks).toString('utf8'), { ts: 0 }); // fixed timestamp: reproducible builds
  fs.writeFileSync(out('media/glyphs.woff'), Buffer.from(ttf2woff(new Uint8Array(ttf.buffer)).buffer));
}
await buildFont();

// ---------- social preview and README header ----------
const FONT = "-apple-system, 'SF Pro Display', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const inner = colorMark({ tile: false, scale: 1 })
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');
function banner(width, height, markSize, titleSize) {
  const markY = (height - markSize) / 2;
  const textX = 96 + markSize + 56;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs><linearGradient id="page" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${COLORS.nightTop}"/><stop offset="1" stop-color="${COLORS.night}"/></linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#page)"/>
  <svg x="96" y="${markY}" width="${markSize}" height="${markSize}" viewBox="0 0 256 256">${inner}</svg>
  <text x="${textX}" y="${height / 2 - titleSize * 0.12}" font-family="${FONT}" font-size="${titleSize}" font-weight="700" fill="#FFFFFF">Many Hats</text>
  <text x="${textX}" y="${height / 2 + titleSize * 0.62}" font-family="${FONT}" font-size="${titleSize * 0.36}" fill="#C7D2FE">Each Claude Code tab on its own account,</text>
  <text x="${textX}" y="${height / 2 + titleSize * 1.08}" font-family="${FONT}" font-size="${titleSize * 0.36}" fill="#C7D2FE">side by side in one window.</text>
</svg>`;
}
render(banner(1280, 640, 300, 104), out('docs/images/social-preview.png'), 1280, 640);
render(banner(1280, 360, 200, 84), out('docs/images/header.png'), 1280, 360);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('brand assets written');
