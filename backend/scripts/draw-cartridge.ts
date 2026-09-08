/**
 * Render a cartridge drawing to PNG for eyeballing. Development only.
 *
 *   npx ts-node -T scripts/draw-cartridge.ts <out-prefix>
 *
 * ⚠️ THE LETTERING HERE IS NOT THE LETTERING IN THE PACK. `cartridgeDrawing()`
 * returns geometry plus text POSITIONS; the pack sets them in its own fonts.
 * This script paints them in with a plain sans so the layout can be checked,
 * which is a preview of the placement, not of the type.
 */
import * as fs from 'fs';
import sharp from 'sharp';
import {
  cartridgeDrawing,
  completeDims,
} from '../src/motivations/motivation-cartridge-drawing';

/** Straight off the sheets held on the box. Nulls are as printed. */
const SHEETS: Record<string, any> = {
  '9luger': {
    name: '9 mm Luger',
    pmaxBar: 2350,
    R: 1.27, R1: 9.96, E: 2.98, E1: 8.79, P1: 9.93, P2: null,
    L1: null, L2: null, L3: 19.15, L6: 29.69, H1: null, H2: 9.65, G1: 9.03,
  },
  '38special': {
    name: '.38 Special',
    pmaxBar: 1500,
    R: 1.5, R1: 11.18, E: null, E1: null, P1: 9.63, P2: null,
    L1: null, L2: null, L3: 29.34, L6: 39.37, H1: null, H2: 9.63, G1: 9.12,
  },
  '223remington': {
    name: '.223 Remington',
    pmaxBar: 4300,
    R: 1.14, R1: 9.6, E: 3.13, E1: 8.43, P1: 9.58, P2: 9.0,
    L1: 36.52, L2: 39.55, L3: 44.7, L6: 57.4, H1: 6.43, H2: 6.43, G1: 5.7,
  },
};

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const out = process.argv[2] ?? 'cartridge';
void (async () => {
  for (const [key, s] of Object.entries(SHEETS)) {
    const c = completeDims(s);
    if (!c) {
      console.log(key, 'NOT DRAWABLE');
      continue;
    }
    const d = cartridgeDrawing(
      c.dims,
      { name: s.name, pmaxBar: s.pmaxBar },
      { derived: c.derived },
    );
    const labelled = d.svg.replace(
      '</svg>',
      d.texts
        .map(
          (t) =>
            `<text x="${t.x.toFixed(2)}" y="${t.y.toFixed(2)}" text-anchor="${
              t.anchor
            }" style="font:${t.size}px sans-serif;fill:${
              t.role === 'caption' ? '#4a443c' : '#1a1613'
            }">${esc(t.text)}</text>`,
        )
        .join('\n') + '\n</svg>',
    );
    fs.writeFileSync(`${out}-${key}.svg`, labelled);
    const i = await sharp(Buffer.from(labelled), { density: 260 })
      .flatten({ background: '#ffffff' })
      .png()
      .toFile(`${out}-${key}.png`);
    console.log(key, 'ok', i.width, i.height, `${d.texts.length} labels`);
  }
})();
