#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────
// MEASURE THE SAPS 271, so the coordinate map is derived rather than eyeballed.
//
// The form has ZERO AcroForm fields — 12 flat pages — so it can only be filled
// by drawing text at absolute coordinates, the way saps534.service.ts already
// fills its form in production. The question is where those coordinates are.
//
// Rather than squint at a rendering and write numbers down, this reads the
// form's OWN GEOMETRY: pdfjs gives every text run a position and every drawn
// path a bounding box, and the form is a table, so its ruling lines ARE its
// boxes. A field is located by naming the label printed next to it; the cell
// its value belongs in falls out of the grid.
//
// That matters for maintenance as much as accuracy. When SAPS reissues the
// form, this is re-run against the new PDF and the map regenerates. A map of
// hand-typed numbers would have to be re-measured by hand, and the failure
// would be silent — text half a centimetre into the wrong box still renders.
//
//   node scripts/saps271-measure.mjs <blank-271.pdf> [fillable-271.pdf] [out.ts]
//
// Pass the FILLABLE template second and every measured box is also BOUND to the
// AcroForm field that covers it. That binding is done by position, never by
// name: the field names in a form prepared by Acrobat or PDFescape are
// auto-generated ("text_36", "TextFormField 3") and differ between two
// preparations of the same form, so a name is not a stable identifier. A
// position is.
//
// Writes src/motivations/saps271-coords.ts. ANYTHING IT CANNOT RESOLVE IS
// REPORTED AND OMITTED — never guessed. An omitted field is a box the applicant
// completes by hand, which is a nuisance; a guessed one is a wrong answer on a
// signed firearm licence application.
// ────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjsPath = require.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const { getDocument, OPS } = await import(pathToFileURL(pdfjsPath).href);

const SRC = process.argv[2];
const FILLABLE = process.argv[3] && process.argv[3].endsWith('.pdf') ? process.argv[3] : null;
const OUT =
  (FILLABLE ? process.argv[4] : process.argv[3]) ??
  path.join(process.cwd(), 'src', 'motivations', 'saps271-coords.ts');

if (!SRC) {
  console.error('usage: node scripts/saps271-measure.mjs <blank-271.pdf> [out.ts]');
  process.exit(1);
}

const r1 = (n) => Math.round(n * 10) / 10;
const uniq = (xs, tol = 1.5) => {
  const s = [...xs].sort((a, b) => a - b);
  const out = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v);
  return out;
};

// ── read the form ───────────────────────────────────────────────────

const doc = await getDocument({
  data: new Uint8Array(fs.readFileSync(SRC)),
}).promise;

const PAGES = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });

  const tc = await page.getTextContent();
  const items = tc.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({
      s: i.str.trim(),
      x: r1(i.transform[4]),
      y: r1(i.transform[5]),
      w: r1(i.width),
    }))
    .sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));

  // Every drawn path carries its bounding box; the thin ones are the rules.
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const rules = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) {
      const [b0, b1, b2, b3, b4, b5] = a;
      ctm = [
        b0 * ctm[0] + b1 * ctm[2], b0 * ctm[1] + b1 * ctm[3],
        b2 * ctm[0] + b3 * ctm[2], b2 * ctm[1] + b3 * ctm[3],
        b4 * ctm[0] + b5 * ctm[2] + ctm[4], b4 * ctm[1] + b5 * ctm[3] + ctm[5],
      ];
    } else if (fn === OPS.constructPath) {
      const bb = a[2];
      if (!bb) continue;
      const [x0, y0] = apply(ctm, bb[0], bb[1]);
      const [x1, y1] = apply(ctm, bb[2], bb[3]);
      const x = Math.min(x0, x1), y = Math.min(y0, y1);
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 0.2 && h < 0.2) continue;
      rules.push({ x: r1(x), y: r1(y), w: r1(w), h: r1(h) });
    }
  }

  PAGES.push({
    page: p,
    width: Math.round(vp.width),
    height: Math.round(vp.height),
    items,
    horiz: rules.filter((r) => r.w > 15 && r.h <= 3),
    vert: rules.filter((r) => r.h > 6 && r.w <= 3),
  });
}

// ── the grid around a label ─────────────────────────────────────────

function ctx(pageNo, labelText, occurrence = 0) {
  const pg = PAGES.find((p) => p.page === pageNo);
  if (!pg) return { error: `no page ${pageNo}` };
  const hits = pg.items.filter((i) => i.s === labelText.trim());
  const lab = hits[occurrence];
  if (!lab) {
    return {
      error: `"${labelText}" occurrence ${occurrence} not on p${pageNo} (${hits.length} found)`,
    };
  }
  const ys = uniq(pg.horiz.map((h) => h.y));
  const bottom = [...ys].filter((y) => y <= lab.y + 1).pop();
  const top = ys.find((y) => y > lab.y + 1);
  if (bottom === undefined || top === undefined) {
    return { error: `"${labelText}" p${pageNo} is not inside a ruled row` };
  }
  const inBand = pg.horiz.filter((h) => h.y >= bottom - 1 && h.y <= top + 1);
  const tableRight = Math.max(...inBand.map((h) => h.x + h.w));
  const verts = uniq(
    pg.vert.filter((v) => v.y < top - 0.5 && v.y + v.h > bottom + 0.5).map((v) => v.x),
  );
  const items = pg.items.filter((i) => i.y > bottom - 1 && i.y < top + 1);
  const cells = [];
  for (let k = 0; k < verts.length - 1; k++) {
    const a = verts[k], b = verts[k + 1];
    cells.push({
      a, b,
      text: items.filter((i) => i.x >= a - 1 && i.x < b).map((i) => i.s).join(' ').trim(),
    });
  }
  return { pg, lab, bottom, top, tableRight, verts, cells, items };
}

/** A value box: from the cell edge right of the label to the next printed text. */
function textBox(pageNo, labelText, occurrence = 0) {
  const c = ctx(pageNo, labelText, occurrence);
  if (c.error) return c;
  const labRight = c.lab.x + c.lab.w;
  const x = c.verts.find((v) => v > labRight - 0.5);
  if (x === undefined) return { error: `no cell edge right of "${labelText}" p${pageNo}` };
  const others = c.items.filter((i) => i !== c.lab && i.x > x + 2);
  const right = others.length ? Math.min(...others.map((o) => o.x)) - 2 : c.tableRight;
  const w = right - x - 2;
  if (w < 8) return { error: `value box after "${labelText}" p${pageNo} is only ${r1(w)}pt wide` };
  return { page: pageNo, kind: 'text', x: r1(x + 2), y: r1(c.bottom), w: r1(w), h: r1(c.top - c.bottom) };
}

/**
 * The EMPTY cell immediately after the one holding an option label.
 *
 * Returns an error where there is no such cell, which is the honest answer for
 * gender: the 271 prints "Male" and "Female" in adjacent cells with nowhere to
 * put an X. Inventing a position there would put a mark over printed text.
 */
function tickCell(pageNo, optionText, occurrence = 0) {
  const c = ctx(pageNo, optionText, occurrence);
  if (c.error) return c;
  const idx = c.cells.findIndex((cell) => cell.text.includes(optionText.trim()));
  if (idx < 0) return { error: `"${optionText}" p${pageNo} is not inside a ruled cell` };
  const next = c.cells[idx + 1];
  if (!next) return { error: `"${optionText}" p${pageNo} is the last cell in its row` };
  if (next.text) return { error: `cell after "${optionText}" p${pageNo} already prints "${next.text}"` };
  return {
    page: pageNo, kind: 'tick',
    x: r1((next.a + next.b) / 2), y: r1((c.bottom + c.top) / 2),
    w: r1(next.b - next.a), h: r1(c.top - c.bottom),
  };
}

/** The LAST cell of a row — the "X" column on the section-D table. */
function rowEndTick(pageNo, rowLabel, occurrence = 0) {
  const c = ctx(pageNo, rowLabel, occurrence);
  if (c.error) return c;
  const last = c.cells[c.cells.length - 1];
  if (!last) return { error: `no cells in the row of "${rowLabel}" p${pageNo}` };
  if (last.text) return { error: `last cell of "${rowLabel}" p${pageNo} prints "${last.text}"` };
  return {
    page: pageNo, kind: 'tick',
    x: r1((last.a + last.b) / 2), y: r1((c.bottom + c.top) / 2),
    w: r1(last.b - last.a), h: r1(c.top - c.bottom),
  };
}

/**
 * A wide box that sits BELOW its heading rather than beside it.
 *
 * Item 61, "Motivation of purpose for which the firearm is required", is a
 * block spanning the page width under its own label. textBox looks to the
 * RIGHT of a label and would find the "(Applicable to all types)" note.
 */
function blockBelow(pageNo, labelText, occurrence = 0) {
  const c = ctx(pageNo, labelText, occurrence);
  if (c.error) return c;
  const ys = uniq(c.pg.horiz.map((h) => h.y));
  const top = c.bottom;
  const bottom = [...ys].filter((y) => y < top - 1).pop();
  if (bottom === undefined) return { error: `nothing below "${labelText}" p${pageNo}` };
  const inBand = c.pg.horiz.filter((h) => h.y >= bottom - 1 && h.y <= top + 1);
  const left = Math.min(...inBand.map((h) => h.x));
  const right = Math.max(...inBand.map((h) => h.x + h.w));
  return {
    page: pageNo, kind: 'text',
    x: r1(left + 4), y: r1(bottom), w: r1(right - left - 8), h: r1(top - bottom),
  };
}


/**
 * One character per cell — identity numbers and split dates.
 *
 * Cells that already print a separator are marked, so the writer skips them
 * instead of stamping a digit over the form's own dash.
 */
function charCells(pageNo, labelText, occurrence = 0) {
  const c = ctx(pageNo, labelText, occurrence);
  if (c.error) return c;
  const labRight = c.lab.x + c.lab.w;
  // Bounded on the right by the next printed text, exactly as textBox is.
  // Without this a row carrying two fields — "Date of issue" and "Expiry date"
  // share one row on page 5 — runs the first field's cells straight through the
  // second's, and the date of issue would be written across both.
  // A lone dash is the form's own group separator PRINTED INSIDE the run of
  // cells, not the start of the next field — stopping at one would cut a
  // 13-digit identity number off after six.
  const isSeparator = (t) => /^[-/.]$/.test(t);
  const others = c.items.filter(
    (i) => i !== c.lab && i.x > labRight + 2 && !isSeparator(i.s),
  );
  const stop = others.length ? Math.min(...others.map((o) => o.x)) : Infinity;
  const cells = c.cells.filter((cell) => cell.a > labRight - 0.5 && cell.b <= stop + 1);
  if (cells.length < 3) return { error: `"${labelText}" p${pageNo} has only ${cells.length} character cells` };
  return {
    page: pageNo, kind: 'chars', y: r1(c.bottom), h: r1(c.top - c.bottom),
    cells: cells.map((cell) => ({ x: r1((cell.a + cell.b) / 2), sep: cell.text || null })),
  };
}

// ── what goes where ─────────────────────────────────────────────────
// Keyed by a stable name the fill service uses. The label strings are the
// form's own printed text, so a reissued form that renames a label FAILS LOUDLY
// here rather than silently writing into the wrong box.

const SPEC = {
  // Section D — which licence is applied for. The X goes in the last column.
  d_section_13: ['rowEnd', 2, 'Licence to possess a firearm for self-defence'],
  d_section_15: ['rowEnd', 2, 'Licence to possess a firearm for occasional hunting and/or sport-shooting'],
  d_section_16: ['rowEnd', 2, 'Licence to possess a firearm for dedicated hunting and/or dedicated sport-shooting'],

  // Section E — the firearm.
  e_type_rifle: ['tick', 2, 'Rifle'],
  e_type_shotgun: ['tick', 2, 'Shotgun'],
  e_type_handgun: ['tick', 2, 'Handgun'],
  e_type_combination: ['tick', 2, 'Combination'],
  e_action_semi_auto: ['tick', 2, 'Semi-automatic'],
  e_action_manual: ['tick', 2, 'Manual'],
  e_calibre: ['text', 2, 'Calibre'],
  e_make: ['text', 2, 'Make'],
  e_model: ['text', 2, 'Model'],
  e_frame_serial: ['text', 2, 'Frame serial number'],
  e_receiver_serial: ['text', 2, 'Receiver serial number'],

  // Section G.1 — the competency certificate.
  g_competency_number: ['text', 5, 'Competency certificate number'],
  g_competency_issued: ['chars', 5, 'Date of issue'],
  g_competency_expiry: ['chars', 5, 'Expiry date'],

  // Section G.3-27 — the applicant.
  g_citizen_sa: ['tick', 6, 'SA citizen'],
  g_citizen_pr: ['tick', 6, 'Non-SA citizen with permanent residence*'],
  g_id_number: ['chars', 6, 'Identity number of private person'],
  g_surname: ['text', 6, 'Surname'],
  // Character cells, not a plain box: the form divides both into one cell per
  // character, and the operator's template gives each cell its own field.
  g_initials: ['chars', 6, 'Initials'],
  g_full_names: ['text', 6, 'Full names'],
  g_date_of_birth: ['chars', 6, 'Date of birth'],
  g_age: ['chars', 6, 'Age'],
  g_residential_address: ['text', 6, 'Residential address'],
  g_postal_address: ['text', 6, 'Postal address'],
  g_residence_type: ['text', 6, 'Type of residence (eg shack, flat, caravan, cottage, house, hostel or homeless)'],
  g_occupation: ['text', 6, 'Trade or profession'],
  g_employer: ['text', 6, 'Name of employer/company'],
  g_business_address: ['text', 6, 'Business address'],
  g_cellphone: ['text', 6, 'Cellphone number'],
  g_email: ['text', 6, 'E-mail address'],
  // Listed so the UNRESOLVED report SAYS so. The 271 prints "Male" and
  // "Female" in adjacent cells with no empty cell between them, so there is
  // nowhere to put an X without marking over the form's own text.
  g_gender_male: ['tick', 6, 'Male'],
  g_gender_female: ['tick', 6, 'Female'],

  g_marital_single: ['tick', 6, 'Single'],
  g_marital_married: ['tick', 6, 'Married'],
  g_marital_divorced: ['tick', 6, 'Divorced'],
  g_marital_widow: ['tick', 6, 'Widow'],
  g_marital_widower: ['tick', 6, 'Widower'],

  // Section G.28-32 — spouse.
  g_spouse_id_type_sa: ['tick', 7, 'SA ID'],
  g_spouse_id_number: ['chars', 7, 'Identity number of spouse'],
  g_spouse_name: ['text', 7, 'Name and surname'],

  // Items 55-60 — accredited association. Central to a section 16 application:
  // dedicated status is the whole basis of it.
  g_association_yes: ['tick', 7, 'YES'],
  g_association_no: ['tick', 7, 'NO'],
  g_association_name: ['text', 7, 'State name of accredited association'],
  g_association_far: ['text', 7, 'FAR number of accredited association'],
  g_association_number: ['text', 7, 'Membership number'],
  g_association_joined: ['chars', 7, 'Date joined'],
  g_association_expiry: ['chars', 7, 'Expiry date'],

  // Item 61 — where the motivation goes.
  //
  // We do NOT write the motivation here. Operator, 2026-08-18: reference the
  // attached document instead of filling it out on the form. That is also the
  // only workable answer — the box is a few lines and the document runs to
  // several pages — and it is how a reviewer expects to find an annexure.
  g_motivation_reference: [
    'block',
    7,
    'Motivation of purpose for which the firearm is required',
  ],

  // Items 62-67 — the history questions. YES/NO repeat down page 8 in the
  // order the questions appear, so they are addressed by occurrence.
  h_conviction_yes: ['tick', 8, 'YES', 0],
  h_conviction_no: ['tick', 8, 'NO', 0],
  h_pending_yes: ['tick', 8, 'YES', 1],
  h_pending_no: ['tick', 8, 'NO', 1],
  h_lost_stolen_yes: ['tick', 8, 'YES', 2],
  h_lost_stolen_no: ['tick', 8, 'NO', 2],
  h_negligence_yes: ['tick', 8, 'YES', 3],
  h_negligence_no: ['tick', 8, 'NO', 3],
  h_unfit_yes: ['tick', 8, 'YES', 4],
  h_unfit_no: ['tick', 8, 'NO', 4],
  h_confiscated_yes: ['tick', 8, 'YES', 5],
  h_confiscated_no: ['tick', 8, 'NO', 5],

  // The first detail slot under each question (the form gives two; we fill one
  // and leave the second, because a second incident is rare and a wrong guess
  // about which slot it belongs in is worse than a blank).
  h_conviction_station: ['text', 8, 'Police station', 0],
  h_conviction_case: ['text', 8, 'CAS/Case number', 0],
  h_conviction_charge: ['text', 8, 'Charge', 0],
  h_conviction_outcome: ['text', 8, 'Outcome', 0],
  h_pending_station: ['text', 8, 'Police station', 2],
  h_pending_case: ['text', 8, 'CAS/Case number', 2],
  h_pending_offence: ['text', 8, 'Offence', 0],
  h_lost_stolen_station: ['text', 8, 'Police station', 4],
  h_lost_stolen_case: ['text', 8, 'CAS/Case number', 4],
  h_lost_stolen_circumstances: ['text', 8, 'Circumstances', 0],
  h_lost_stolen_firearm: ['text', 8, 'Details of firearm', 0],

  // Items 68-69 — the safe.
  safe_yes: ['tick', 9, 'YES', 0],
  safe_no: ['tick', 9, 'NO', 0],
  safe_type_handgun: ['tick', 9, 'Handgun'],
  safe_type_rifle: ['tick', 9, 'Rifle'],
  safe_type_strongroom: ['tick', 9, 'Strongroom'],
  safe_type_device: ['tick', 9, 'Device'],
  safe_mounted_yes: ['tick', 9, 'YES', 1],
  safe_mounted_no: ['tick', 9, 'NO', 1],
  safe_mounted_wall: ['tick', 9, 'Wall'],
  safe_mounted_floor: ['tick', 9, 'Floor'],
};

// ── bind each measured box to a field in the fillable template ──────
//
// BY POSITION, NEVER BY NAME. Two preparations of the same form produce
// different auto-generated names — the operator's carries "text_36" and
// "TextFormField 3" where another carries "XFive years" — so a name identifies
// nothing. The box we measured off the printed form is the stable thing, and
// whichever widget sits on top of it is the field that fills it.

async function loadWidgets(file) {
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const idx = new Map(pdf.getPages().map((pg, i) => [pg.ref.toString(), i + 1]));
  const widgets = [];
  for (const f of pdf.getForm().getFields()) {
    const kind =
      f.constructor.name === 'PDFCheckBox' ? 'checkbox'
      : f.constructor.name === 'PDFSignature' ? 'signature'
      : 'text';
    for (const w of f.acroField.getWidgets()) {
      const r = w.getRectangle();
      widgets.push({
        name: f.getName(), kind,
        page: idx.get(String(w.dict.get(w.dict.context.obj('P')))) ?? 0,
        x: r.x, y: r.y, w: r.width, h: r.height,
      });
    }
  }
  return widgets;
}

const areaOverlap = (a, b) => {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
};

/** Bind one measured field, mutating it in place. Returns a note for the report. */
function bind(name, f, widgets) {
  if (f.kind === 'chars') {
    // One widget per digit is what the operator's template gives us, and it is
    // the right shape: a 13-digit identity number belongs one digit to a cell.
    const ys = f.y + f.h / 2;
    const names = f.cells
      .filter((c) => !c.sep)
      .map((c) => {
        const w = widgets.find(
          (w) => w.page === f.page && w.kind !== 'signature' &&
            c.x >= w.x && c.x <= w.x + w.w && ys >= w.y && ys <= w.y + w.h,
        );
        return w ? w.name : null;
      });
    const covered = names.filter(Boolean).length;
    if (covered === names.length && new Set(names).size === names.length) {
      f.fields = names;
      return null;
    }
    return `${name}: ${covered}/${names.length} digit cells have their own field — falling back to drawing the digits`;
  }

  const box = f.kind === 'tick' ? { x: f.x - f.w / 2, y: f.y - f.h / 2, w: f.w, h: f.h } : f;
  const best = widgets
    .filter((w) => w.page === f.page && w.kind !== 'signature' && areaOverlap(box, w) > 0)
    .map((w) => ({ w, ov: areaOverlap(box, w) / (box.w * box.h) }))
    .sort((a, b) => b.ov - a.ov)[0];

  // A widget that barely clips the box is the NEIGHBOURING row, not this one.
  // Binding to it would put the value one line off — visible, wrong, and the
  // kind of thing nobody notices until a DFO does.
  if (!best || best.ov < 0.5) {
    return `${name}: no field covers this box${best ? ` (nearest "${best.w.name}" overlaps only ${Math.round(best.ov * 100)}%)` : ''} — falling back to drawing the value`;
  }
  f.field = best.w.name;
  f.fieldKind = best.w.kind;
  return null;
}

const RESOLVERS = {
  text: textBox,
  tick: tickCell,
  chars: charCells,
  rowEnd: rowEndTick,
  block: blockBelow,
};

const resolved = {};
const failed = [];
for (const [name, [kind, page, label, occ]] of Object.entries(SPEC)) {
  const r = RESOLVERS[kind](page, label, occ ?? 0);
  if (r.error) failed.push({ name, kind, page, label, error: r.error });
  else resolved[name] = r;
}

const unbound = [];
if (FILLABLE) {
  const widgets = await loadWidgets(FILLABLE);
  for (const [name, f] of Object.entries(resolved)) {
    const note = bind(name, f, widgets);
    if (note) unbound.push(note);
  }
}

// ── emit ────────────────────────────────────────────────────────────

const banner = `// GENERATED by scripts/saps271-measure.mjs — DO NOT EDIT BY HAND.
//
// Measured from the blank SAPS 271 by reading the form's own geometry: pdfjs
// gives every text run a position and every drawn path a bounding box, and the
// form is a table, so its ruling lines are its boxes. Each entry below was
// located by naming the label the form prints beside it.
//
// Regenerate after ANY change to the blank form:
//   node scripts/saps271-measure.mjs assets/saps271-blank.pdf
//
// Coordinates are PDF user space: origin BOTTOM-LEFT, points, A4 ${PAGES[0].width}x${PAGES[0].height}.
// \`y\` is the bottom of the row, so a caller adds its own baseline padding.
//
// ${Object.keys(resolved).length} of ${Object.keys(SPEC).length} fields resolved.
// The rest are listed in UNRESOLVED below and are left BLANK on the form: a box
// the applicant completes by hand is a nuisance, a guessed coordinate is a
// wrong answer on a signed firearm licence application.
`;

const body = `${banner}
/**
 * A field bound to the fillable template carries \`field\`; one that is not
 * carries only its measured box and is DRAWN instead. Both paths are real —
 * the operator's template has no field over Calibre or Make on page 2.
 */
export interface Saps271Bound {
  /** AcroForm field name in the template, where one covers this box. */
  field?: string;
  fieldKind?: 'text' | 'checkbox';
}

export interface Saps271TextBox extends Saps271Bound {
  kind: 'text';
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Saps271Tick extends Saps271Bound {
  kind: 'tick';
  page: number;
  /** Centre of the tick cell. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Saps271CharCells {
  kind: 'chars';
  page: number;
  y: number;
  h: number;
  /** One field per digit, in order, where the template provides them. */
  fields?: string[];
  /** Cell centres in order. \`sep\` marks a cell the form already prints into. */
  cells: { x: number; sep: string | null }[];
}

export type Saps271Field = Saps271TextBox | Saps271Tick | Saps271CharCells;

export const SAPS271_PAGE_SIZE = { width: ${PAGES[0].width}, height: ${PAGES[0].height} } as const;

export const SAPS271_PAGES = ${doc.numPages};

export const SAPS271_COORDS = ${JSON.stringify(resolved, null, 2)} as const satisfies Record<string, Saps271Field>;

export type Saps271FieldName = keyof typeof SAPS271_COORDS;

/**
 * Fields the measuring pass could NOT locate, with the reason.
 *
 * Kept in the generated output on purpose. A missing key is otherwise invisible
 * — the fill service would simply never write that box and nobody would know
 * why. Gender is the interesting one: the form prints "Male" and "Female" in
 * adjacent cells with no empty cell to mark, so there is nowhere to put an X.
 */
/**
 * Measured boxes with NO field over them in the template, so the fill service
 * draws the value instead of setting a field. Not a defect — the operator's
 * template simply has no field over these — but the values still land, and this
 * list is what tells anyone why some values are editable and some are not.
 */
export const SAPS271_DRAWN_NOT_FIELDED: string[] = ${JSON.stringify(
  unbound.map((u) => u.split(':')[0]),
  null,
  2,
)};

export const SAPS271_UNRESOLVED: { name: string; label: string; page: number; reason: string }[] = ${JSON.stringify(
  failed.map((f) => ({ name: f.name, label: f.label, page: f.page, reason: f.error })),
  null,
  2,
)};
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body.replace(/\r?\n/g, '\n'), 'utf8');

console.log(`SAPS 271: ${doc.numPages} pages, ${PAGES[0].width}x${PAGES[0].height}`);
console.log(`resolved ${Object.keys(resolved).length}/${Object.keys(SPEC).length} fields → ${OUT}`);
if (failed.length) {
  console.log(`\nUNRESOLVED (left blank on the form, never guessed):`);
  for (const f of failed) console.log(`  ${f.name.padEnd(30)} ${f.error}`);
}
if (FILLABLE) {
  const bound = Object.values(resolved).filter((f) => f.field || f.fields).length;
  console.log(
    `\nbound ${bound}/${Object.keys(resolved).length} boxes to fields in ${path.basename(FILLABLE)}`,
  );
  if (unbound.length) {
    console.log('NOT BOUND — the value is DRAWN onto the page instead:');
    for (const u of unbound) console.log(`  ${u}`);
  }
}
