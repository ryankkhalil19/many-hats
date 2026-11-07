// The Many Hats mark, as shapes on a 256 × 256 grid: a top hat (work) with a cap (personal)
// stepping out in front of it. scripts/brand.mjs turns these into every icon and image.
export const TOP_HAT_CROWN = 'M66,42 H126 Q137,42 137.6,53 L142,140 H50 L54.4,53 Q55,42 66,42 Z';
export const TOP_HAT_BAND = 'M51.9,114 H140.1 L141.2,138 H50.8 Z';
export const TOP_HAT_BRIM =
  'M20,148 Q20,140 30,140 H162 Q172,140 172,148 Q172,156 162,156 H30 Q20,156 20,148 Z';
export const CAP =
  'M98,206 C98,174 122,150 156,150 C188,150 210,168 212,190 Q236,188 252,200 Q252,214 232,214 L104,214 Q98,214 98,206 Z';
export const CAP_BILL = 'M212,190 Q236,188 252,200 Q252,214 232,214 L208,214 Z';
export const CAP_SEAM = 'M156,152 Q144,178 146,212';

export const COLORS = {
  night: '#14113A',
  nightTop: '#312C85',
  paper: '#E0E7FF',
  band: '#6366F1',
  mint: '#5EEAD4',
  mintDeep: '#2DD4BF',
  mintDark: '#14B8A6',
};

/** The color mark on its tile. scale < 1 leaves a margin inside the tile. */
export function colorMark({ size = 256, tile = true, scale = 0.86 } = {}) {
  const art = `<g transform="translate(128 128) scale(${scale}) translate(-136 -128)">
    <g mask="url(#gap)">
      <path fill="${COLORS.paper}" d="${TOP_HAT_CROWN}"/>
      <path fill="${COLORS.band}" d="${TOP_HAT_BAND}"/>
      <path fill="${COLORS.paper}" d="${TOP_HAT_BRIM}"/>
    </g>
    <path fill="${COLORS.mint}" d="${CAP}"/>
    <path fill="${COLORS.mintDeep}" d="${CAP_BILL}"/>
    <path fill="none" stroke="${COLORS.mintDark}" stroke-width="5" stroke-linecap="round" d="${CAP_SEAM}"/>
    <circle cx="156" cy="151" r="7" fill="${COLORS.mintDark}"/>
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${COLORS.nightTop}"/>
      <stop offset="1" stop-color="${COLORS.night}"/>
    </linearGradient>
    <mask id="gap" maskUnits="userSpaceOnUse" x="-64" y="-64" width="384" height="384">
      <rect x="-64" y="-64" width="384" height="384" fill="#fff"/>
      <path fill="#000" stroke="#000" stroke-width="16" stroke-linejoin="round" d="${CAP}"/>
    </mask>
  </defs>
  ${tile ? '<rect width="256" height="256" rx="56" fill="url(#bg)"/>' : ''}
  ${art}
</svg>
`;
}
