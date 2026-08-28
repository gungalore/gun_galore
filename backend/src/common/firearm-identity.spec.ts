import {
  FIREARM_FIELDS,
  firearmIdentityPrompt,
  parseFirearmReading,
} from './firearm-identity';

const reply = (
  fields: { key: string; value: string; confidence?: string }[],
) => JSON.stringify({ fields });

describe('the prompt asks for a firearm and not a person', () => {
  const p = firearmIdentityPrompt();

  it('refuses personal data explicitly', () => {
    // Operator: "we need the firearm details and not the details of the owner
    // for this part of the exercise". On these documents the personal data is
    // the most sensitive text on the page, so not asking is the control.
    expect(p).toMatch(/DO NOT RETURN ANYTHING ABOUT A PERSON/);
    expect(p).toMatch(/No names, no ID numbers/);
  });

  it('tells the model not to classify the document first', () => {
    // The whole point of this reader: a kind-first extraction turns every
    // unrecognised genre into a dead end, and the applicant has "atleast
    // something" rather than a known form.
    expect(p).toMatch(/DO NOT try/);
    expect(p).toMatch(/do not refuse because it is none of/);
  });

  it('describes every field semantically instead of naming it', () => {
    // ⚠️ THE FIX FOR "a license number that the description can come in lost of
    // spellings and forms". A bare key name makes the model match a printed
    // caption; captions vary and the page is full of other numbers.
    for (const f of FIREARM_FIELDS) {
      expect(p).toContain(`- ${f.key}: `);
      // A description, not a restatement of the key.
      expect(f.describe.length).toBeGreaterThan(40);
      // And it must not be satisfied by echoing the key back with spaces.
      expect(f.describe.toLowerCase()).not.toBe(f.key.replace(/_/g, ' '));
    }
    // Sampled proof that the descriptions name the CONFUSION, not the caption
    // — which is what a bare key name could never do.
    expect(p).toMatch(/It is not the calibre and not the type/);
    expect(p).toMatch(/"self-loading" and "S\/L" both mean semi-automatic/);
  });

  it('reads the section E boxes we fill', () => {
    // Operator, 2026-08-28: "read the 271 form and see what it requires for the
    // applied for fire arm." Section E, box for box:
    //
    //   1    type            1.1  action        1.2  engraved names/addresses
    //   1.3  calibre         1.4  calibre code  1.5  make      1.6  model
    //   1.7  barrel serial   1.8  barrel make
    //   1.9  frame serial    1.10 frame make
    //   1.11 receiver serial 1.12 receiver make
    //
    // ⚠️ "Firearm component type:" IS A HEADING over those three rows, not a
    // numbered field — the numbering runs 1.6 Model straight to 1.7 Barrel
    // serial. I first read it as a field and cited every serial one box too
    // high; the comment on firearm_serial in motivation-fields.ts had it right
    // all along.
    const keys = FIREARM_FIELDS.map((f) => f.key);
    for (const k of [
      'firearm_type',
      'firearm_action',
      'firearm_calibre',
      'firearm_make',
      'firearm_model',
      'firearm_serial',
      'barrel_serial',
      'barrel_make',
      'frame_serial',
      'frame_make',
      'receiver_serial',
      'receiver_make',
    ]) {
      expect(keys).toContain(k);
    }
  });

  it('deliberately does NOT read three of the boxes', () => {
    // Operator's call, 2026-08-28. The calibre CODE (1.4) is an official code
    // most documents do not carry, the component type (1.7) only applies when
    // the thing being licensed is a bare barrel or frame rather than a whole
    // firearm, and names engraved in the metal (1.2) are rare.
    //
    // ✅ AND DROPPING 1.2 REMOVED THE ONE HOLE IN THE PRIVACY RULE. While it
    // was read, "return nothing about a person" needed an exception for names
    // cut into metal — a distinction a model had to get right on every
    // document. There is no exception now: no field here can hold a person.
    const keys = FIREARM_FIELDS.map((f) => f.key);
    for (const k of [
      'calibre_code',
      'firearm_component_type',
      'engraved_names_addresses',
    ]) {
      expect(keys).not.toContain(k);
    }
  });

  it('⚠️ DOES NOT ASK FOR A LICENCE NUMBER — it is not in section E', () => {
    // My error and the operator's, corrected against the form itself: the
    // section of the Act is chosen in part D as the TYPE of licence applied
    // for, and the existing licence over the firearm belongs to part F,
    // "particulars of current owner". Neither is a description of the firearm.
    const keys = FIREARM_FIELDS.map((f) => f.key);
    expect(keys).not.toContain('licence_number');
    expect(keys).not.toContain('section');
    expect(p).toMatch(/no licence number/);
  });

  it('keeps every serial paired with its OWN make', () => {
    // The form gives each serial row its own make box (1.9, 1.11, and the
    // receiver's), and the seller-consent snapshot already records why: they
    // genuinely differ — one real card reads barrel CZ, receiver NONE,
    // frame NONE. One shared `make` cannot fill three boxes.
    const keys = FIREARM_FIELDS.map((f) => f.key);
    for (const part of ['barrel', 'frame', 'receiver']) {
      expect(keys).toContain(`${part}_serial`);
      expect(keys).toContain(`${part}_make`);
    }
  });

  it('⚠️ keeps the HEADLINE serial separate from the barrel row', () => {
    // Corrected against the operator's own licence card, which reads:
    //
    //   Serial Number       MR90189D
    //   Barrel Serial No    NONE          Make NONE
    //   Receiver Serial No  MR90189D      Make MARLIN
    //   Frame Serial No     NONE          Make NONE
    //
    // The headline number matches the RECEIVER row and the barrel row is
    // empty, because the receiver IS the firearm on that design. A reader that
    // treated barrel_serial as the firearm's serial would have returned NONE
    // for this card — for the one number a DFO actually asks about.
    const keys = FIREARM_FIELDS.map((f) => f.key);
    expect(keys).toContain('firearm_serial');
    expect(keys).toContain('barrel_serial');
    // The identifying one comes first among the serials.
    for (const other of ['barrel_serial', 'frame_serial', 'receiver_serial']) {
      expect(keys.indexOf('firearm_serial')).toBeLessThan(keys.indexOf(other));
    }
    expect(p).toMatch(/THE SERIAL NUMBER THAT IDENTIFIES THE FIREARM/);
    expect(p).toMatch(/THE MOST IMPORTANT FIELD HERE/);
    // And the barrel row is explicitly warned about.
    expect(p).toMatch(/NOT necessarily the firearm.s serial number/);
  });

  it('expects the component rows to read NONE, and says to leave them out', () => {
    // "All the other fields may have a NONE or a number attached to it, it all
    // depends on the firearm."
    expect(p).toMatch(/may legitimately read NONE/);
    expect(p).toMatch(/Leave a NONE row out rather than copying/);
  });

  it('forbids copying one serial into another serial’s field', () => {
    // ⚠️ THIS CODEBASE HOLDS FOUR OPINIONS ABOUT HOW MANY SERIALS EXIST — the
    // vault reads frame and barrel, the motivation's source proof reads one
    // flat `firearm_serial`, and the consent snapshot reads barrel, receiver,
    // frame and a headline serial, each with its own make, "because they
    // genuinely differ". Collapsing them here would let the frame serial be
    // returned as the barrel serial.
    expect(p).toMatch(/NEVER copy one serial into another serial/);
  });
});

describe('parsing the reply', () => {
  it('keeps the firearm fields', () => {
    const out = parseFirearmReading(
      reply([
        { key: 'firearm_make', value: 'CZ' },
        { key: 'firearm_model', value: '457' },
        { key: 'barrel_serial', value: 'B-0042' },
      ]),
    );
    expect(out.values).toEqual({
      firearm_make: 'CZ',
      firearm_model: '457',
      barrel_serial: 'B-0042',
    });
  });

  it('⚠️ DISCARDS PERSONAL DATA THE MODEL VOLUNTEERS ANYWAY', () => {
    // The prompt asks for none. A prompt is a request; the allowlist is the
    // control. This is the same question-and-filter rule the vault's WANTED
    // registry relies on.
    const out = parseFirearmReading(
      reply([
        { key: 'firearm_make', value: 'Beretta' },
        { key: 'holder_name', value: 'A Person' },
        { key: 'id_number', value: '8001015009087' },
        { key: 'residential_address', value: '1 Example Road' },
      ]),
    );
    expect(out.values).toEqual({ firearm_make: 'Beretta' });
  });

  it('records low confidence per field', () => {
    const out = parseFirearmReading(
      reply([
        { key: 'barrel_serial', value: 'B-0042', confidence: 'low' },
        { key: 'firearm_make', value: 'CZ', confidence: 'high' },
      ]),
    );
    expect(out.lowConfidence).toEqual(['barrel_serial']);
  });

  it('treats "N/A" and friends as absence, not as a value', () => {
    // A model told to omit rather than guess still sometimes says so out loud,
    // and "Not stated" written into a serial box on a signed application is
    // worse than an empty box.
    for (const v of ['N/A', 'n/a', 'none', 'None', 'unknown', 'Not visible']) {
      const out = parseFirearmReading(reply([{ key: 'barrel_serial', value: v }]));
      expect(out.values).toEqual({});
    }
  });

  it('survives a model that answered in prose', () => {
    expect(parseFirearmReading('I could not read this document.')).toEqual({
      values: {},
      lowConfidence: [],
    });
    expect(parseFirearmReading('')).toEqual({ values: {}, lowConfidence: [] });
  });

  it('drops empty values rather than writing blanks over real answers', () => {
    const out = parseFirearmReading(
      reply([
        { key: 'firearm_make', value: '   ' },
        { key: 'firearm_model', value: 'T3x' },
      ]),
    );
    expect(out.values).toEqual({ firearm_model: 'T3x' });
  });
});
