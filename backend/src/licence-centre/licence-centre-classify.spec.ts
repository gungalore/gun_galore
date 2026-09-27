import { CredentialKind } from '@prisma/client';
import {
  CLASSIFY_USER,
  LicenceCentreExtractService,
} from './licence-centre-extract.service';
import type { LlmResponse } from '../common/llm/llm.types';

/** Kinds that survive only for rows filed before a consolidation. */
const RETIRED = new Set<string>([
  // → DEDICATED_DISCIPLINE, 2026-08-20.
  'DEDICATED_STATUS',
  'DEDICATED_HUNTER',
  'PROFESSIONAL_HUNTER',
  'GOOD_STANDING',
  // → SAFE_PHOTOGRAPHS, 2026-08-23.
  'SAFE_PHOTO_CLOSED',
  'SAFE_PHOTO_AJAR',
  'SAFE_PHOTO_BOLTS',
  'SAFE_INSTALLATION',
]);

/**
 * NOT RETIRED — A KIND THE VAULT MENU MUST NOT OFFER.
 *
 * ⚠️ EVIDENCE IS A `CredentialKind` AND IS NOT A DOCUMENT CATEGORY. The vault's
 * classifier files photographed documents by TYPE; an evidence item (a hunting
 * photograph, a permission letter) has no type and is sorted instead into a
 * container by the evidence classifier — see
 * MotivationExtractService.classifyEvidence. classify() now answers a `role`
 * before a kind (see VaultClassifyAnswer), and files an evidence item as
 * EVIDENCE without a kind; but it is the ROLE that says so, not a member
 * picking this off a menu.
 *
 * Offering EVIDENCE on this menu would invite a member to file a photographed
 * document as an evidence item by hand, and an evidence row is never offered in
 * the document picker (NON_PICKABLE) — they would be handed a row with nowhere
 * to go. Same failure the RETIRED block describes, a different cause.
 */
const NOT_A_DOCUMENT = new Set<string>(['EVIDENCE']);

// ⚠️ A CATEGORY THE ENUM KNOWS AND THE PROMPT DOES NOT is a document that
// files itself as OTHER on every upload — silently, with no error anywhere,
// and the member correcting us by hand each time. GOOD_STANDING shipped that
// way: added to the enum, the vault menu, the extractor's field list and the
// motivation requirements, and left out of the one prompt that decides what a
// photograph IS.
describe('the classifier prompt', () => {
  it('names every kind a document can still be filed as', () => {
    // ⚠️ THE RETIRED KINDS ARE DELIBERATELY ABSENT. Postgres cannot drop an
    // enum value, so all eight are still in CredentialKind — but offering one
    // here would invite the classifier to file a document outside every query
    // that now looks for the kind that replaced it.
    for (const kind of Object.values(CredentialKind)) {
      if (RETIRED.has(kind) || NOT_A_DOCUMENT.has(kind)) {
        // The option lines all read "<KIND> - description", so the absence of
        // that exact form is what proves the kind is not on the menu.
        expect(CLASSIFY_USER).not.toContain(`${kind} -`);
        continue;
      }
      expect(CLASSIFY_USER).toContain(kind);
    }
  });

  it('⚠️ MAKES THE ASSOCIATION DOCUMENTS ONE CATEGORY, not four', () => {
    // THIS REVERSES A DELIBERATE EARLIER DECISION. The four were separated
    // because a status certificate, a sworn letter and a PH registration are
    // different papers — true, and it did not matter, because the SPLIT MADE
    // THE CLASSIFIER GUESS. On a certificate from a body accredited for both
    // hunting and sport it guessed from the letterhead and filed the
    // operator's sport-shooter status as DEDICATED_HUNTER: the wrong status
    // on a section 16 application.
    //
    // One category removes the guess. Which discipline it awards, and whether
    // the member is in good standing, are read off the document afterwards.
    expect(CLASSIFY_USER).toMatch(/DEDICATED_DISCIPLINE/);
    expect(CLASSIFY_USER).toMatch(/DO NOT TRY TO TELL THEM APART/i);
    // And it must say so for each of the papers it now absorbs, or a member
    // watching us file their letter of good standing as "dedicated
    // discipline" has no way to know that is correct.
    expect(CLASSIFY_USER).toMatch(/letter of good standing/i);
    expect(CLASSIFY_USER).toMatch(/professional hunter/i);
    expect(CLASSIFY_USER).toMatch(/membership certificate/i);
  });

  it('says a member may hold several, from different associations', () => {
    expect(CLASSIFY_USER).toMatch(/several of these from different/i);
  });

  it('⚠️ MAKES THE SAFE PHOTOGRAPHS ONE CATEGORY, not four', () => {
    // SAME MISTAKE, SAME FIX. The four were separated so the requirement
    // engine could say which shot was missing — and telling them apart means
    // judging how far a door is open from a single frame, which is why every
    // answer had to be forced to low confidence. A wrong one filed the bolts
    // shot under the closed-door annexure, so a DFO looking for proof the
    // bolts engage was shown a photograph of a shut door.
    //
    // ⚠️ AND THE PROMPT STILL DESCRIBES EVERY SHOT. Not so the model sorts
    // them — so it recognises all four as the same category rather than
    // dropping the anchoring shot into OTHER.
    expect(CLASSIFY_USER).toMatch(/SAFE_PHOTOGRAPHS -/);
    expect(CLASSIFY_USER).toMatch(/door shut/i);
    expect(CLASSIFY_USER).toMatch(/key in it/i);
    expect(CLASSIFY_USER).toMatch(/locking\s+bolts/i);
    expect(CLASSIFY_USER).toMatch(/bolted to a wall or floor/i);
  });

  it('keeps OTHER an explicit, respectable answer', () => {
    // A guess dressed as certainty is worse than "unsorted": the member is
    // asked to confirm either way, and only one of the two tells them to look.
    expect(CLASSIFY_USER).toMatch(/OTHER - anything else, or you cannot tell/);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE FIRST QUESTION: IS THIS A DOCUMENT, OR IS IT EVIDENCE?
//
// ⚠️ EVIDENCE HAS NO KIND. A hunting photograph or a landowner's permission
// letter is not one of our document categories, and forcing it into one is how
// a member is told a requirement is met by something that answers nothing. The
// role is answered before the kind, and an evidence answer must survive as
// evidence.
// ────────────────────────────────────────────────────────────────────
const fakeLlm = (reply: string | Error, configured = true) => ({
  complete: jest.fn().mockImplementation((): Promise<LlmResponse> => {
    if (reply instanceof Error) return Promise.reject(reply);
    return Promise.resolve({
      text: reply,
      parts: [{ type: 'text', text: reply }],
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 10, outputTokens: 10 },
      model: 'test-model-2.5',
      provider: 'gemini',
      assistantMessage: { role: 'assistant', content: reply },
    } as LlmResponse);
  }),
  stream: jest.fn(),
  isConfigured: () => configured,
  isConfiguredFor: () => configured,
  providerNameFor: () => 'gemini',
  model: 'test-model-2.5',
  provider: 'gemini' as const,
});

const svcWith = (reply: string | Error) =>
  new LicenceCentreExtractService(fakeLlm(reply) as never);

const png = { bytes: Buffer.from('x'), mimeType: 'image/png' };

describe('the document-or-evidence role', () => {
  it('returns a document role with its kind', async () => {
    await expect(
      svcWith('{"role":"document","kind":"FIREARM_LICENCE","confidence":"high"}')
        .classify(png),
    ).resolves.toMatchObject({
      role: 'document',
      kind: CredentialKind.FIREARM_LICENCE,
      confident: true,
    });
  });

  it('⚠️ returns evidence as evidence, with no kind', async () => {
    await expect(
      svcWith(
        '{"role":"evidence","kind":"OTHER","confidence":"high"}',
      ).classify(png),
    ).resolves.toEqual({ role: 'evidence', confident: true });
  });

  it('⚠️ reads an unrecognised role as null, never as a document', async () => {
    // DeepSeek ignores the JSON schema entirely, so a junk role must be
    // refused in code: a wrong filing is worse than a question.
    await expect(
      svcWith('{"role":"banana","kind":"FIREARM_LICENCE","confidence":"high"}')
        .classify(png),
    ).resolves.toBeNull();
  });

  it('reads a kind of EVIDENCE as evidence even with no role', async () => {
    await expect(
      svcWith('{"kind":"EVIDENCE","confidence":"high"}').classify(png),
    ).resolves.toEqual({ role: 'evidence', confident: true });
  });
});
