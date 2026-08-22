import { MotivationLicenceType } from '@prisma/client';

// ────────────────────────────────────────────────────────────────────
// THE WORDS OF THE ACT, SO THE WRITER NEVER HAS TO REMEMBER THEM.
//
// Rule 4 of the generation prompt has been waiting for this file. It says the
// statutory section may quote ONLY from a <statutory-text> block, and that
// where no block is supplied the writer must name the section by number and
// argue in plain language instead. That was a safe fallback, not a good
// outcome: the approved motivations we studied all quote the section they
// apply, and a section applied element by element against the applicant's own
// facts is the part a reviewer actually checks.
//
// ⚠️ WHY IT COULD NOT SIMPLY BE RECALLED. A model asked for "section 16 of the
// Firearms Control Act" will produce something that reads exactly right and is
// wrong in a detail nobody catches — and this text goes into a document the
// applicant SIGNS and files with the Registrar. Quoting an Act from memory
// into a sworn application is a false statement about the law, which is why
// rule 4 forbade quoting at all until there was a source.
//
// ⚠️ THE SOURCE IS THE CONSOLIDATED TEXT, NOT THE ACT AS ENACTED. Supplied by
// the operator 2026-08-23 from NATSHOOT: the Firearms Control Act 60 of 2000
// as amended by Act 43 of 2003, Act 28 of 2006, Act 6 of 2010 and Act 37 of
// 2013. That distinction is not academic here —
//
//   • s 16(1)(c) was SUBSTITUTED by s 4 of Act 43 of 2003. The as-enacted
//     wording is not the law and has not been since 2003.
//   • s 16A (professional hunting) was INSERTED by s 12 of Act 28 of 2006 and
//     does not appear in the original Act at all.
//
// ⚠️ TRANSCRIBED, THEN PROOFREAD AGAINST THE PDF. The page furniture in the
// source ("Prepared by:", "Page 28 of 112") is stripped, and nothing else is.
// Spelling and punctuation are the Act's own, including "sports-shooting" and
// the Act's inconsistent capitalisation. Do not tidy them: the whole value of
// this file is that it is quotable verbatim.
//
// ⚠️ IF THE ACT IS AMENDED AGAIN, THIS FILE IS WRONG UNTIL SOMEBODY UPDATES
// IT. There is no feed. That is the trade for being able to quote at all, and
// it is why AS_AT is exported and rendered into the prompt — so the writer can
// be told how current the text is rather than assuming.
//
// PURE — no Nest, no Prisma, no clock, no network.
// ────────────────────────────────────────────────────────────────────

/** How current this transcription is. Rendered into the prompt. */
export const AS_AT = 'as amended to 2013 (Act 37 of 2013)';

const S13 = `13. Licence to possess firearm for self-defence

(1) A firearm in respect of which a licence may be issued in terms of this section is any -

    (a) shotgun which is not fully or semi-automatic; or

    (b) handgun which is not fully automatic.

(2) The Registrar may issue a licence under this section to any natural person who -

    (a) needs a firearm for self-defence; and

    (b) cannot reasonably satisfy that need by means other than the possession of a firearm.

(3) No person may hold more than one licence issued in terms of this section.

(4) A firearm in respect of which a licence has been issued in terms of this section may be used where it is safe to use the firearm and for a lawful purpose.`;

const S15 = `15. Licence to possess firearm for occasional hunting and sports-shooting

(1) A firearm in respect of which a licence may be issued in terms of this section is any -

    (a) handgun which is not fully automatic;

    (b) rifle or shotgun which is not fully or semi-automatic; or

    (c) barrel, frame or receiver of a handgun, rifle or shotgun contemplated in paragraph (a) or (b),

    and which is not a restricted firearm.

(2) The Registrar may issue a licence in terms of this section to any natural person who is an occasional hunter or occasional sports person.

(3)
    (a) Subject to paragraphs (b), (c) and (d), no person may hold more than four licences issued in terms of this section.

    (b) If a person holds a licence issued in terms of section 13, he or she may only hold three licences issued in terms of this section.

    (c) A person may not hold more than one licence in respect of a handgun contemplated in subsection (1)(a).

    (d) If a person contemplated in paragraph (a) holds any additional licences contemplated in section 12 in respect of a firearm contemplated in this section and section 13, the number of licences which that person may hold must be reduced by the number of such additional licences held.

(4) A firearm in respect of which a licence has been issued in terms of this section may be used where it is safe to use the firearm and for a lawful purpose.`;

const S16 = `16. Licence to possess firearm for dedicated hunting and dedicated sports-shooting

(1) A firearm in respect of which a licence may be issued in terms of this section is any -

    (a) handgun which is not fully automatic;

    (b) rifle or shotgun which is not fully automatic;

    (c) semi-automatic shotgun manufactured to fire no more than five shots in succession without having to be reloaded; or

    (d) barrel, frame or receiver of a handgun, rifle or shotgun contemplated in paragraph (a), (b) or (c).

(2) The Registrar may issue a licence in terms of this section to any natural person who is a dedicated hunter or dedicated sports person if the application is accompanied by a sworn statement or solemn declaration from the chairperson of an accredited hunting association or sports-shooting organisation, or someone delegated in writing by him or her, stating that the applicant is a registered member of that association.

(3) A firearm in respect of which a licence has been issued in terms of this section may be used where it is safe to use the firearm and for a lawful purpose.

(4) Every accredited hunting association and sports-shooting organisation must -

    (a) keep a register which contains such information as may be prescribed; and

    (b) submit an annual report to the Registrar which contains such information as may be prescribed.`;

const S24 = `24. Renewal of firearm licences

(1) The holder of a licence issued in terms of this Chapter who wishes to renew the licence must at least 90 days before the date of expiry of the licence apply to the Registrar for its renewal.

(2) The application must be -

    (a) accompanied by such information as may be prescribed; and

    (b) delivered to the Designated Firearms Officer responsible for the area in which the applicant ordinarily resides or in which the applicant's business is, as the case may be.

(3) No application for the renewal of a licence may be granted unless the applicant shows that he or she has continued to comply with the requirements for the licence in terms of this Act.

(4) If an application for the renewal of a licence has been lodged within the period provided for in subsection (1), the licence remains valid until the application is decided.`;

/**
 * What each licence type's statutory section actually says.
 *
 * ⚠️ ONE SECTION, NOT A LIBRARY. The temptation is to hand over the storage
 * section, the competency section and the general application regulation as
 * well — and rule 7 is the reason not to. A motivation that reproduces four
 * pages of statute is padding wearing a legal costume, and the corpus we
 * studied does exactly that in places. The writer gets the section it is
 * applying for, and nothing else.
 */
const BY_TYPE: Record<MotivationLicenceType, string> = {
  S13_SELF_DEFENCE: S13,
  S15_OCCASIONAL_HUNTER: S15,
  S16_DEDICATED_HUNTER: S16,
  S16_DEDICATED_SPORT: S16,
  // ⚠️ A RENEWAL IS JUDGED ON s24(3) — "has continued to comply with the
  // requirements for the licence" — so the renewal section is the one that
  // governs, not whichever section the original licence was issued under. The
  // 90-day rule in s24(1) and the keeps-it-alive rule in s24(4) are the two
  // facts a renewal applicant most needs on the page.
  S24_RENEWAL: S24,
};

export function statutoryTextFor(t: MotivationLicenceType): string {
  return BY_TYPE[t];
}

/**
 * The block as the prompt renders it.
 *
 * ⚠️ THE INSTRUCTIONS TRAVEL WITH THE TEXT. Rule 4 already says what to do
 * with a supplied block, but the two failure modes worth repeating next to the
 * words themselves are quoting more than is applied, and quoting a section
 * this file does not carry.
 */
export function renderStatute(t: MotivationLicenceType): string {
  return `
THE STATUTORY TEXT. Below is the section this application is made under, taken
from the Firearms Control Act 60 of 2000 ${AS_AT}. It is a verbatim
transcription and it is the ONLY law you may quote.

⚠️ QUOTE ONLY WHAT YOU APPLY. Set out the subsections that bear on this
applicant, numbered as they are here, and answer each one immediately beneath
it with their own facts — the element, then the fact that satisfies it. A
quoted subsection left hanging with no fact under it is padding, and reproducing
the whole section because it is available is the same mistake at greater
length.

⚠️ NOTHING ELSE FROM THE ACT. If an argument seems to need another section, a
regulation, or a definition, make it in plain words instead. Anything not
between these tags is something you remembered, and a remembered Act in a
signed application is a false statement about the law.

<statutory-text>
${statutoryTextFor(t)}
</statutory-text>`.trim();
}
