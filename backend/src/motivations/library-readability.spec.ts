import { CREDENTIAL_TO_UPLOAD } from './motivation-credentials';
import { MotivationExtractService } from './motivation-extract.service';
import { WANTED } from '../licence-centre/licence-centre-extract.service';

// ────────────────────────────────────────────────────────────────────
// THE AMBER THAT SURVIVED TWO FIXES.
//
// Operator, 2026-08-23: "when some documents like my ID for example are pulled
// [into the] document centre in the motivation it stays amber, why?"
//
// The motivation checklist paints a row amber — "Attached, but we could not
// read anything off it" — when `canExtract(kind) && !extractionOk`. A document
// copied out of the vault therefore has to arrive carrying the vault's verdict
// on whether it was readable.
//
// ⚠️ WHAT MADE THIS HARD TO SEE. addFromLibrary derived that verdict from an
// EXACT key-name intersection between two registries that name the same values
// differently, so "was it readable" was answered by "do the field names happen
// to collide". They mostly do not, and nothing failed — the copy just arrived
// looking broken. Two separate fixes were written and shipped against this
// symptom before anybody noticed the intersection was empty.
//
// These tests pin the two facts that would have caught it immediately.
describe('the two key registries genuinely do not line up', () => {
  // This is the DOCUMENTED, DELIBERATE state of the world, not an aspiration.
  // It is asserted so that anybody who later makes `extraction.ok` depend on
  // the intersection again is told, by a failing test, exactly why that is
  // wrong.
  it('has an EMPTY intersection for the kinds the vault actually reads', () => {
    const empties: string[] = [];

    for (const [credentialKind, uploadKinds] of Object.entries(
      CREDENTIAL_TO_UPLOAD,
    )) {
      const uploadKind = (uploadKinds as string[])[0];
      if (!uploadKind) continue;
      // Only kinds the checklist can flag are interesting — a safe photograph
      // extracts nothing by design and never goes amber.
      if (!MotivationExtractService.canExtract(uploadKind as never)) continue;

      const vaultKeys: string[] = (WANTED as Record<string, string[]>)[
        credentialKind
      ] ?? [];
      // A kind the vault never reads cannot produce a stale reading either.
      if (vaultKeys.length === 0) continue;

      const wanted = new Set(
        MotivationExtractService.wantedFor(uploadKind as never),
      );
      const overlap = vaultKeys.filter((k) => wanted.has(k));
      if (overlap.length === 0) empties.push(`${credentialKind} -> ${uploadKind}`);
    }

    // If this list ever shrinks to nothing, somebody has added an alias layer
    // and the comment in addFromLibrary needs revisiting. If it GROWS, a new
    // kind has joined the same trap.
    expect(empties.length).toBeGreaterThan(0);
  });

  it('names the firearm licence as one of them, because that is the reported case', () => {
    const vaultKeys = (WANTED as Record<string, string[]>).FIREARM_LICENCE ?? [];
    const wanted = new Set(
      MotivationExtractService.wantedFor('CURRENT_LICENCE' as never),
    );
    expect(vaultKeys.length).toBeGreaterThan(0);
    expect(wanted.size).toBeGreaterThan(0);
    // The vault holds the make and the serial; the registry wants the same
    // things under existing_firearm_1_* names. Nothing collides.
    expect(vaultKeys.filter((k) => wanted.has(k))).toEqual([]);
  });

  it('confirms the ID document DOES line up, which is why seeding it works', () => {
    // kyc-id-adoption writes full_name and id_number precisely because those
    // are the two keys EXTRACTABLE.IDENTITY_DOCUMENT declares. Renaming either
    // side silently re-breaks the fix, so pin the agreement.
    const wanted = MotivationExtractService.wantedFor(
      'IDENTITY_DOCUMENT' as never,
    );
    expect(wanted.sort()).toEqual(['full_name', 'id_number']);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE GAP THAT PRODUCED THE REPORTED BUG.
//
// The operator's own ID was amber for a reason none of the above covers: the
// vault asked for NOTHING when reading it (WANTED.IDENTITY_DOCUMENT was []),
// so extractionOk could never become true, while the motivation registry
// declared the kind readable. Between them the two registries guaranteed a
// permanent amber on a perfectly legible document.
//
// ⚠️ THE SPEC ABOVE COULD NOT CATCH IT — it skips kinds whose vault list is
// empty, which is exactly the broken state. This one closes that hole.
describe('no kind can be declared readable and then never read', () => {
  it('has no credential kind the vault ignores but the checklist judges', () => {
    const permanentlyAmber: string[] = [];

    for (const [credentialKind, uploadKinds] of Object.entries(
      CREDENTIAL_TO_UPLOAD,
    )) {
      const uploadKind = (uploadKinds as string[])[0];
      if (!uploadKind) continue;
      if (!MotivationExtractService.canExtract(uploadKind as never)) continue;

      const vaultKeys: string[] =
        (WANTED as Record<string, string[]>)[credentialKind] ?? [];
      if (vaultKeys.length === 0) {
        permanentlyAmber.push(
          `${credentialKind} -> ${uploadKind}: the vault asks for nothing, ` +
            `so extractionOk can never be true, but canExtract says the ` +
            `checklist will judge it. Either give the vault keys to read ` +
            `(matching ${JSON.stringify(
              MotivationExtractService.wantedFor(uploadKind as never),
            )}) or drop the kind from EXTRACTABLE.`,
        );
      }
    }

    expect(permanentlyAmber).toEqual([]);
  });
});
