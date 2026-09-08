import type { SheetItem, SheetResponse } from '../contract';

// ────────────────────────────────────────────────────────────────────
// THE FIXTURE SHEET THE COMPONENT SPECS AND THE GATES RUN AGAINST.
//
// ⚠️ INVENTED DATA, ALWAYS, AND THE NAME IS THE ONLY REAL-LOOKING THING HERE.
// "Johan Pretorius" and MO000066 come from the design canvas, which invented
// them for the same reason. The ID number below is NOT a valid SA identity
// number and will not pass readSaId — that is deliberate: a fixture that
// validates is a fixture somebody will eventually paste somewhere real.
//
// ⚠️ NEVER PUT A REAL DOCUMENT NEAR THIS FILE. The scanner work keeps its
// photographs in `scan-fixtures/`, which is gitignored, precisely because they
// carry a name, an identity number and firearm serials. Nothing of that kind
// belongs in a committed fixture.
// ────────────────────────────────────────────────────────────────────

export const filled = (over: Partial<SheetItem> = {}): SheetItem => ({
  key: 'firearm_make',
  label: 'Make',
  kind: 'short',
  state: 'filled',
  value: 'CZ',
  provenance: {
    source: 'READ',
    from: 'Your licence card',
    at: '2026-09-01T00:00:00.000Z',
  },
  section: 'firearm',
  scope: 'application',
  required: true,
  ...over,
});

export const suggested = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 'firearm_model',
    label: 'Model',
    state: 'suggested',
    value: 'Shadow 2',
    provenance: {
      source: 'READ',
      from: 'Your licence card',
      at: '2026-09-01T00:00:00.000Z',
      inferred: true,
    },
    ...over,
  });

export const needsYou = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 'firearm_calibre',
    label: 'Calibre',
    state: 'needs_you',
    value: '',
    provenance: null,
    help: '9mm Parabellum',
    ...over,
  });

export const notApplicable = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 'spouse_name',
    label: "Spouse or partner's full name",
    state: 'na',
    value: '',
    provenance: null,
    ...over,
  });

export const cardsItem = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 's13_reasons',
    label: 'What makes you believe you need it',
    kind: 'cards',
    state: 'needs_you',
    value: '',
    provenance: null,
    section: 'case',
    options: [
      {
        key: 'precinct_crime',
        sentence:
          'I live in a policing precinct with a documented housebreaking and robbery problem.',
      },
      {
        key: 'night_travel',
        sentence:
          'I regularly travel at night, or on roads where I would be on my own if I stopped.',
      },
      {
        key: 'rented',
        sentence:
          'I rent, so I cannot make structural changes to secure the property further.',
      },
    ],
    ownWordsKey: 'threat_circumstances',
    ...over,
  });

export const ownWordsItem = (over: Partial<SheetItem> = {}): SheetItem =>
  filled({
    key: 'threat_circumstances',
    label: 'Anything else about your circumstances',
    kind: 'long',
    state: 'needs_you',
    value: '',
    provenance: null,
    required: false,
    section: 'case',
    ...over,
  });

/** A whole sheet, for the page-level specs and the interaction-count gates. */
export const sheet = (over: Partial<SheetResponse> = {}): SheetResponse => ({
  application: {
    id: 'mo-1',
    referenceNumber: 'MO000066',
    licenceType: 'S16_DEDICATED_SPORT',
    licenceTypeLabel: 'Section 16 — Dedicated sport shooter',
    label: null,
    status: 'DRAFT',
  },
  sections: [
    { id: 'firearm', title: 'The firearm', blurb: 'What you are applying for.', missing: [] },
    { id: 'you', title: 'You', blurb: 'Your details as they will appear on the form.', missing: [] },
    { id: 'competency', title: 'Competency', blurb: 'Read off your certificates.', missing: [] },
    { id: 'own', title: 'Firearms you own', blurb: 'What you already hold.', missing: [] },
    { id: 'premises', title: 'Premises and storage', blurb: 'Where the firearm will live.', missing: [] },
    { id: 'case', title: 'Your case', blurb: 'Tap what is true of you.', missing: [] },
    { id: 'declarations', title: 'Declarations', blurb: 'Six questions everybody is asked.', missing: [] },
    { id: 'pack', title: 'Your pack', blurb: 'What you will take to the DFO.', missing: [] },
  ],
  items: [filled(), suggested(), needsYou(), cardsItem(), ownWordsItem()],
  documents: [
    {
      id: 'u1',
      kind: 'IDENTITY_DOCUMENT',
      letter: 'A',
      label: 'Identity document',
      mime: 'image/jpeg',
      state: 'read',
    },
  ],
  needs: { needs: [] },
  coverage: {},
  overlap: { verdict: { kind: 'clear' }, prompt: null, suggestedAngle: null },
  preview: [],
  missing: ['firearm_calibre', 's13_reasons'],
  ...over,
});
