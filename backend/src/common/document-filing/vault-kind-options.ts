import { CredentialKind } from '@prisma/client';
import type { FilingOption } from './document-filing.service';

// ────────────────────────────────────────────────────────────────────
// THE VAULT'S FOLDER VOCABULARY, AS JEV SEES IT.
//
// ⚠️ ONE PLACE, SO IT CANNOT DRIFT FROM THE ENUM. Every option here is a live
// CredentialKind. The retired kinds (DEDICATED_STATUS, DEDICATED_HUNTER,
// PROFESSIONAL_HUNTER, GOOD_STANDING, the four SAFE_PHOTO_* and
// SAFE_INSTALLATION) are deliberately ABSENT: filing a new row under one of
// them puts it outside every query that now looks for the live kind, which is
// exactly what RETIRED_KINDS exists to prevent.
//
// ⚠️ THE HINTS ARE THE DISCRIMINATORS, and they carry the rules the old vision
// prompt learned the hard way: association paperwork is ONE kind whatever the
// letterhead says, and it is an ENDORSEMENT only when it names a firearm by
// serial. A hint that loses those rules sends a section 16 certificate to the
// wrong folder.
// ────────────────────────────────────────────────────────────────────

export const VAULT_KIND_OPTIONS: readonly FilingOption[] = [
  {
    id: CredentialKind.FIREARM_LICENCE,
    label: 'Firearm licence',
    hint: 'a South African FIREARM licence card or certificate. The text must name a firearm (a make, model, calibre or serial) or cite a section of the Firearms Control Act. A licence for anything else — a driver\u2019s, TV, business, fishing or software licence, or a EULA — is NOT this: file it as Something else.',
  },
  {
    id: CredentialKind.COMPETENCY_CERTIFICATE,
    label: 'Competency certificate',
    hint: 'a SAPS competency certificate (the SAPS 524, or the older plastic card), naming a firearm category. It carries NO SAQA unit-standard number — a page with a unit-standard number such as 117705 or 119649 is a Proficiency, not this.',
  },
  {
    id: CredentialKind.DEDICATED_DISCIPLINE,
    label: 'Association or dedicated-status document',
    hint: 'ANY document from a shooting or hunting association about one of its members: a membership certificate, dedicated sport-shooter or hunter status, a section 16 letter of good standing, or professional-hunter registration. All one category; do NOT split them by the letterhead.',
  },
  {
    id: CredentialKind.ASSOCIATION_ENDORSEMENT,
    label: 'Association endorsement',
    hint: 'an association endorsement of ONE SPECIFIC FIREARM: it names that gun by serial, calibre, make or action. If it does not name a firearm, it is the association/dedicated-status document instead.',
  },
  {
    id: CredentialKind.PROFICIENCY,
    label: 'Proficiency',
    hint: 'a firearm proficiency / unit-standard training certificate: the PFTC Statement of Results, or a training provider\u2019s own certificate. It carries SAQA unit-standard NUMBERS \u2014 117705 (Knowledge of the Firearms Control Act), 119649 (handgun), 119650 (self-loading rifle), 119651 (manually operated rifle), 119652 (shotgun), 243200 (muzzle-loader). A page showing any of those numbers is this, whatever it titles itself: a provider\u2019s "COMPETENCY COURSE" certificate is a Proficiency, NOT a competency certificate.',
  },
  {
    id: CredentialKind.IDENTITY_DOCUMENT,
    label: 'Identity document',
    hint: 'a South African ID book or smart ID card, or the photo page of a passport',
  },
  {
    id: CredentialKind.ADDRESS_CONFIRMATION,
    label: 'Proof of address',
    hint: 'a document proving where the member lives, such as a utility bill or bank statement',
  },
  {
    id: CredentialKind.EMPLOYMENT_CONFIRMATION,
    label: 'Employment letter',
    hint: "a letter confirming the member's employment",
  },
  {
    id: CredentialKind.SAFE_PHOTOGRAPHS,
    label: 'Safe photographs',
    hint: 'a photograph of a gun safe or its installation',
  },
  {
    id: CredentialKind.SHOOTING_ACTIVITY_LOG,
    label: 'Shooting activity log',
    hint: 'a log or record of shooting activity or range visits',
  },
  {
    id: CredentialKind.OTHER,
    label: 'Something else',
    hint: 'a personal document we keep but do not file under a specific type',
  },
];

/**
 * The kinds Jev is asked to test for `also_covers`. The same live set minus
 * OTHER, because "also something else" is not a role a document fills. The
 * service drops whichever kind the primary answer named.
 */
export const VAULT_COVER_OPTIONS: readonly FilingOption[] =
  VAULT_KIND_OPTIONS.filter((o) => o.id !== CredentialKind.OTHER);
