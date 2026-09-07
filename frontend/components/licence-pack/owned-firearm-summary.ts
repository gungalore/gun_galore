// ────────────────────────────────────────────────────────────────────
// HOW A FIREARM SOMEBODY ALREADY OWNS IS LISTED.
//
// Operator, 2026-09-07: "when listing the fire arms I already own it should
// only be the make, model, serial number and expiry date listed, nothing else."
//
// Two screens list them and they must list them the same way: the collapsed row
// on the "What you own" step, and the Document Centre prefill offer, which
// printed SEVEN lines per firearm — type, calibre, make, use, two serials and a
// licence number — so three licences filled the panel with twenty-one rows.
//
// ⚠️ THE OTHER COLUMNS ARE NOT REMOVED, THEY ARE NOT LISTED. Type, calibre, use
// and the licence number remain registry fields and still go onto the form: the
// SAPS 271 asks for them, and the duplicate-calibre argument in a motivation is
// built out of the calibres. They are simply not how a person recognises their
// own firearm on a list.
//
// ⚠️ READ DEFENSIVELY, IN BOTH DIRECTIONS. The registry is mid-change: a single
// `_serial` is replacing `_frame_serial` / `_barrel_serial`, and `_model` and
// `_expiry` are being added. Everything here takes whichever columns it is
// handed, so both screens are correct before that lands and after it — an older
// answer set simply shows fewer of the four.
//
// ⚠️ AND A LIST MUST NEVER BE EMPTY WHERE SOMETHING WILL BE WRITTEN. The offer
// panel's own header promises that "what would be filled, and which document
// each value came from, is on screen before the button is pressed". A firearm
// whose make, model, serial and expiry are all absent — because the member
// typed them in already, or because only the type and calibre were read — has
// no four-value line to draw, so it is NOT collapsed: its own columns are shown
// instead. A row reading "Firearm 3" with an empty value beside it, over a
// button that writes three answers, breaks that promise silently.
// ────────────────────────────────────────────────────────────────────

// ⚠️ THE SAME RULE THE SERVER APPLIES AT THE ANSWER BOUNDARY, IN A SECOND,
// DELIBERATE COPY — there is no import path from the browser bundle to
// backend/src/common/card-placeholder.ts. See lib/card-placeholder.ts for why,
// and for the one thing that must be kept in step by hand.
import { answerValue } from '@/lib/card-placeholder';

/** `existing_firearm_3_frame_serial` → slot "3", column "frame_serial". */
export const OWNED_FIREARM_KEY = /^existing_firearm_(\d+)_(.+)$/;

/**
 * How many owned-firearm rows the served registry actually has.
 *
 * ⚠️ NEVER A LITERAL. `6` was written into three places on the live wizard —
 * the "which rows are filled" scan, the row filter and the "Add another
 * firearm" gate — and the registry went to FOURTEEN on 2026-09-07 because the
 * blank SAPS 271's item 2.1 is fourteen identical rows. The offer then wrote
 * rows 7 to 14 into the answers where no screen rendered them, nobody could
 * correct them, and the wizard went on saying "that is as many as we can print
 * on the form" at six. The registry is the only thing that knows; ask it.
 *
 * Returns 0 while the fields are still loading, which callers must read as
 * "add nothing yet" rather than as a cap of one.
 */
export function ownedRowCap(fields: readonly { key: string }[]): number {
  let max = 0;
  for (const f of fields) {
    const m = OWNED_FIREARM_KEY.exec(f.key);
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
}

/**
 * The four values that identify a firearm to the person who owns it, in the
 * order the operator named them.
 *
 * ⚠️ SERIAL, THEN BARREL, THEN FRAME — the server's order, not the reverse.
 * `ownedFirearmSerial` in backend/src/motivations/motivation-fields.ts reads
 * `_serial`, then `_barrel_serial`, then `_frame_serial`, and the reason is
 * written down beside it: a licence prints the barrel number first. Reading
 * frame first here meant these two screens could name a different number from
 * the one the printed 271 carries, on the same firearm, with nothing to say
 * which was right.
 *
 * ⚠️ AND "NONE" IS NOT A SERIAL. The operator's cards print NONE against a row
 * that does not apply, and on the firearms where the two serials genuinely
 * differ one of them says exactly that. Every column goes through
 * `answerValue`, so a placeholder falls through to the next candidate instead
 * of being printed as the firearm's identity.
 */
export function firearmLine(cols: Record<string, string | undefined>): string {
  const serial =
    answerValue(cols.serial) ||
    answerValue(cols.barrel_serial) ||
    answerValue(cols.frame_serial);
  return [
    answerValue(cols.make),
    answerValue(cols.model),
    serial,
    answerValue(cols.expiry),
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The same line, read straight off the application's answers. */
export function ownedFirearmSummary(
  slot: number | string,
  answers: Record<string, string>,
): string {
  const at = (col: string) => answers[`existing_firearm_${slot}_${col}`] ?? '';
  return firearmLine({
    make: at('make'),
    model: at('model'),
    serial: at('serial'),
    frame_serial: at('frame_serial'),
    barrel_serial: at('barrel_serial'),
    expiry: at('expiry'),
  });
}

export interface OfferRow {
  key: string;
  label: string;
  value: string;
  /**
   * True when this one line stands for a whole firearm's worth of answers.
   *
   * ⚠️ THE PANEL'S "and the rest goes on the form too" SENTENCE HANGS OFF
   * THIS, not off a length comparison. `rows.length < items.length` is false
   * when exactly ONE column of a firearm is offered — the case where the line
   * hides the most — so the sentence disappeared precisely when it was needed.
   */
  collapsed?: boolean;
}

/**
 * A prefill offer as lines, with each owned firearm collapsed into one.
 *
 * ⚠️ A FIREARM TAKES THE POSITION OF ITS FIRST COLUMN. Building the collapsed
 * rows and appending them after everything else is the obvious implementation
 * and it is wrong: it hoists every unrelated value above the firearms it sits
 * between. The pack screen's own partitionKeys carries the same rule and the
 * same warning, learned the same way.
 *
 * ⚠️ AND A FIREARM WITH NO LINE IS NOT COLLAPSED AT ALL. See the header: the
 * offer only carries the answers the member has NOT already given, so a firearm
 * whose make and serial they typed themselves can arrive here as nothing but a
 * type and a calibre. Collapsing that produced a row with an empty value beside
 * a button that would still write both answers.
 */
export function offerRows(
  items: readonly { key: string; label: string; value: string }[],
): OfferRow[] {
  interface Slot {
    slot: string;
    cols: Record<string, string>;
    items: { key: string; label: string; value: string }[];
  }
  const out: (OfferRow | Slot)[] = [];
  const slots = new Map<string, Slot>();
  for (const item of items) {
    const m = OWNED_FIREARM_KEY.exec(item.key);
    if (!m) {
      out.push({ key: item.key, label: item.label, value: item.value });
      continue;
    }
    const [, slot, col] = m;
    let held = slots.get(slot);
    if (!held) {
      held = { slot, cols: {}, items: [] };
      slots.set(slot, held);
      out.push(held);
    }
    held.cols[col] = item.value;
    held.items.push(item);
  }

  // Second pass, because whether a firearm collapses depends on every column
  // of it and the first pass has only seen the ones that came before.
  const rows: OfferRow[] = [];
  for (const entry of out) {
    if (!('slot' in entry)) {
      rows.push(entry);
      continue;
    }
    const line = firearmLine(entry.cols);
    if (line) {
      rows.push({
        key: `existing_firearm_${entry.slot}`,
        label: `Firearm ${entry.slot}`,
        value: line,
        collapsed: true,
      });
      continue;
    }
    rows.push(...entry.items);
  }
  return rows;
}
