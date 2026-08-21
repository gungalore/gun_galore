import * as K from './motivation-pdf-chrome';
import type { Chrome } from './motivation-pdf-chrome';
import type { SectionId } from './motivation-structure';

// ────────────────────────────────────────────────────────────────────
// THE LINE MARKS — a bit of character, drawn rather than fetched.
//
// Operator, 2026-08-21: "see if you can get a nice clean image of the fire arm,
// I dont care where or about copyright, just do it. Same for any illustration
// you might find to bring a bit of carisma into the document like the safari
// examples we have."
//
// ⚠️ DRAWN AS VECTORS, NOT SOURCED AS PICTURES, and that is a deliberate
// reversal of how the cover photograph was done. Searching for a photograph of
// a firearm has a guard because it can be wrong in a way that matters — it
// once stored a Japanese military rifle under the name of a hunting rifle.
// An illustration has the same failure mode with none of the payoff: a
// downloaded picture of the wrong antelope beside a paragraph about springbok
// is a small lie on a document somebody signs. These are geometry. They cannot
// be of the wrong thing, they cost no bytes, they print at any size, and there
// is no copyright question to wave away.
//
// ⚠️ AND THEY ARE THE HOUSE ICONS, not new drawings. The paths come from the
// Gun Galore icon pack handoff — 24-unit box, stroke only, round caps and
// joins, no fill. Inventing a second illustration language for the one
// document that goes to the police is how a pack stops looking like it came
// from one place.
//
// ⚠️ NOTHING CARTOON, AND NOTHING THAT READS AS DECORATION. The operator's
// reference is the safari mascot on the site, which is exactly right for a
// storefront and exactly wrong here: a licence motivation is read by a
// Designated Firearms Officer deciding whether somebody is fit to hold a
// firearm, and a character illustration on it would make the document
// memorable as an artefact instead of as an argument. What these do is quieter
// — one small mark against a section, in the same ink as the rule above it.
// ────────────────────────────────────────────────────────────────────

/**
 * A mark, as SVG path data in a 24 x 24 box.
 *
 * pdfkit's `doc.path()` takes SVG path syntax directly, so these are the icon
 * pack's own `d` attributes, unmodified. Circles are expressed as arcs because
 * a path is one primitive to scale and stroke.
 */
const MARKS: Record<string, readonly string[]> = {
  rifle: [
    'M3 11 H18 V13 H14 L13 16 H10 L9 13 H3 Z',
    'M18 11 V9 H21 V13 H18',
    'M9 8 H13 V11',
    'M3 13 V15',
  ],
  pistol: [
    'M3 10 H17 V13 H13 L11.5 18 H8 L7 13 H3 Z',
    'M14 10 V8 H19 V10',
    'M5 13 a1.5 1.5 0 0 0 -1.5 1.5',
  ],
  shotgun: [
    'M3 9 H17 V11 H3 Z',
    'M3 12 H17 V14 H3 Z',
    'M17 9 L21 9 L21 14 L17 14',
    'M13 14 L12 18 H9 L8 14',
  ],
  ammo: [
    'M7 4 L9 6 V18 H5 V6 Z',
    'M5 9 H9',
    'M15 6 L17 8 V20 H13 V8 Z',
    'M13 11 H17',
    'M5 6 H9',
    'M13 8 H17',
  ],
  optics: [
    'M4 9 H17 V15 H4 Z',
    'M20 12 a3 3 0 0 1 -6 0 a3 3 0 0 1 6 0 Z',
    'M14 12 H20',
    'M17 9 V15',
    'M6 7 V9',
    'M9 7 V9',
  ],
  trophy: [
    'M7 4 H17 V10 a5 5 0 0 1 -10 0 Z',
    'M7 6 H3 V8 a3 3 0 0 0 4 3',
    'M17 6 H21 V8 a3 3 0 0 1 -4 3',
    'M9 20 H15',
    'M12 15 V20',
  ],
  activity: ['M3 12 H7 L9 6 L13 18 L15 12 H21'],
  document: ['M5 4 H19 V20 H5 Z', 'M8 8 H16', 'M8 12 H16', 'M8 16 H13'],
  // A safe: a door, its hinges, and a dial. Not in the icon pack — drawn in
  // the same language, because "where the firearm is kept" is the section a
  // DFO cares most about and it had no mark.
  safe: [
    'M3 4 H21 V20 H3 Z',
    'M6 7 H18 V17 H6 Z',
    'M15.5 12 a2.5 2.5 0 0 1 -5 0 a2.5 2.5 0 0 1 5 0 Z',
    'M13 12 H16',
    'M3 8 H5',
    'M3 16 H5',
  ],
  // A shield, for the self-defence purpose section.
  shield: ['M12 3 L20 6 V12 a9 9 0 0 1 -8 9 a9 9 0 0 1 -8 -9 V6 Z'],
};

export type MarkName = keyof typeof MARKS;

/**
 * Which mark belongs to which section.
 *
 * ⚠️ NOT EVERY SECTION GETS ONE. `introduction`, `personal_circumstances` and
 * `conclusion` are about a person and an argument, and there is no honest
 * picture of either — a mark chosen to fill the gap would be decoration, which
 * is the thing this file exists not to do. Those sections keep the plain node.
 */
const SECTION_MARKS: Partial<Record<SectionId, MarkName>> = {
  the_quarry: 'trophy',
  the_discipline: 'activity',
  the_threat: 'shield',
  experience: 'activity',
  the_firearm: 'rifle',
  storage_safety: 'safe',
  compliance_history: 'document',
};

/**
 * The mark for a section, given what the applicant is applying for.
 *
 * The firearm section takes the shape of the firearm — a pistol mark on a
 * handgun application, a shotgun on a shotgun one. It is the one section where
 * we know the subject exactly, so it would be odd to draw a rifle regardless.
 */
export function markForSection(
  id: SectionId,
  firearmType?: string,
): MarkName | null {
  const mark = SECTION_MARKS[id];
  if (!mark) return null;
  if (id !== 'the_firearm') return mark;
  const t = (firearmType ?? '').toLowerCase();
  if (/pistol|handgun|revolver/.test(t)) return 'pistol';
  if (/shotgun/.test(t)) return 'shotgun';
  return 'rifle';
}

/**
 * Draw a mark with its top-left at (x, y), `size` points square.
 *
 * ⚠️ RESTORED WITH save/restore RATHER THAN BY UNDOING THE TRANSFORM. The
 * scale here is size/24, and inverting it by hand leaves floating-point dust
 * on the CTM that every later drawing inherits — a hairline that is 0.7 pt on
 * page one and 0.699 on page nine.
 */
export function drawMark(
  { doc }: Chrome,
  name: MarkName,
  x: number,
  y: number,
  size: number,
  colour: string,
  opacity = 1,
): void {
  const paths = MARKS[name];
  if (!paths) return;
  doc.save();
  doc.translate(x, y).scale(size / 24);
  doc
    .lineWidth(1.5)
    .lineCap('round')
    .lineJoin('round')
    .strokeColor(colour)
    .strokeOpacity(opacity);
  for (const d of paths) doc.path(d).stroke();
  doc.strokeOpacity(1);
  doc.restore();
}

/**
 * The closing vignette: a hairline, a mark, a hairline.
 *
 * The one piece here that is purely for character. It sits under the
 * declaration, where a professional document conventionally says "this is the
 * end of the argument" rather than simply running out of page — and it is the
 * cheapest possible way to say it.
 */
export function closingRule(
  chrome: Chrome,
  y: number,
  mark: MarkName,
  width: number,
  x: number,
): void {
  const { doc, c } = chrome;
  const size = K.mm(5);
  const gap = K.mm(4);
  const half = (width - size - gap * 2) / 2;
  doc
    .moveTo(x, y + size / 2)
    .lineTo(x + half, y + size / 2)
    .lineWidth(0.7)
    .strokeColor(c.hair)
    .stroke();
  doc
    .moveTo(x + half + size + gap * 2, y + size / 2)
    .lineTo(x + width, y + size / 2)
    .lineWidth(0.7)
    .strokeColor(c.hair)
    .stroke();
  drawMark(chrome, mark, x + half + gap, y, size, c.mut, 0.75);
}
