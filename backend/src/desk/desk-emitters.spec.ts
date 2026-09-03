import * as fs from 'fs';
import * as path from 'path';

/**
 * 🚨 EVERY CARD TYPE MUST BE EMITTED, OR SAID OUT LOUD.
 *
 * This project's signature failure: a type lands in DeskCardType, a drawer is
 * built for it, the client routes it — and nothing ever pushes one onto the
 * pile. Nothing errors. tsc is happy. Both files read as finished. It has now
 * happened three times (complaint, support, and whatsapp_reply), and each time
 * it was found by a human reading the wrong file at the right moment.
 *
 * So the catalogue is no longer allowed to outrun the wire silently. A type is
 * either emitted by desk.service.ts, or it is listed below with the reason —
 * and the reason has to be written by someone who knows it is missing.
 */

const SRC = path.join(__dirname, 'desk.service.ts');
const TYPES = path.join(__dirname, 'desk.types.ts');

/**
 * Types that deliberately have no emitter yet. ⚠️ ADDING A NAME HERE IS A
 * DECISION, NOT A FIX — it says "we know this card cannot appear". Removing a
 * name without adding an emitter turns the test red, which is the point.
 */
const NOT_YET_EMITTED: Record<string, string> = {
  whatsapp_reply:
    'No inbound-message store, no 24h-window model, no template registry and no send path exist ' +
    'on the backend. The drawer (components/desk/whatsapp-drawer.tsx) is built and unreachable. ' +
    'Needs a Prisma model plus the WABA env vars before it can be emitted.',
};

function declaredTypes(): string[] {
  const src = fs.readFileSync(TYPES, 'utf8');
  const block = src.slice(src.indexOf('export type DeskCardType'));
  const end = block.indexOf(';');
  return [...block.slice(0, end).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('the card catalogue cannot outrun the wire', () => {
  const declared = declaredTypes();
  const service = fs.readFileSync(SRC, 'utf8');

  it('finds the card types at all', () => {
    // If this fails the parse broke and every assertion below is vacuous.
    expect(declared.length).toBeGreaterThan(5);
    expect(declared).toContain('firearm_transfer');
  });

  it.each(declared)('%s is either emitted or documented as missing', (type) => {
    const emitted = service.includes(`type: '${type}'`);
    if (emitted) {
      expect(NOT_YET_EMITTED[type]).toBeUndefined();
      return;
    }
    const reason = NOT_YET_EMITTED[type];
    // The message rides in the compared VALUE, because jest's expect takes no
    // message argument — a bare "expected undefined to be defined" would not
    // tell the next person what to do about it.
    const verdict =
      reason === undefined
        ? `${type}: in DeskCardType, emitted by NOTHING. Emit it, or add it to ` +
          `NOT_YET_EMITTED with the reason it cannot be.`
        : `${type}: documented as not yet emitted`;
    expect(verdict).toBe(`${type}: documented as not yet emitted`);
    expect(reason!.length).toBeGreaterThan(40);
  });

  it('does not carry a stale excuse for a type that is now emitted', () => {
    for (const type of Object.keys(NOT_YET_EMITTED)) {
      expect(declared).toContain(type);
      expect(service.includes(`type: '${type}'`)).toBe(false);
    }
  });
});
