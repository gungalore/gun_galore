import { MotivationUploadKind } from '@prisma/client';
import {
  CARRIES_FORWARD,
  carriesForwardAsAnswer,
  effectiveDay,
  priorAnswers,
  priorReadings,
} from './prior-readings';
import { VAULTABLE } from './vault-adoption.service';

// ────────────────────────────────────────────────────────────────────
// WHAT WE READ LAST TIME, USED THIS TIME.
//
// Operator, 2026-08-29: "Nothing that is scanned and OCR'd is ever discarded.
// We will use the information to fill out forms an future applications."
//
// The keeping half was already true. The USING half was not: a stored
// extraction was read by exactly one thing — the 117705 check — so a member
// starting a second application retyped everything their first one had already
// read off their ID.
// ────────────────────────────────────────────────────────────────────

const at = (d: string) => new Date(`${d}T09:00:00.000Z`);
const row = (
  kind: MotivationUploadKind,
  when: string,
  values: Record<string, string> | null,
) => ({ kind, createdAt: at(when), values });

describe('what carries forward', () => {
  it('uses a reading from an earlier application', () => {
    const { values, from } = priorReadings([
      row('IDENTITY_DOCUMENT', '2026-01-10', {
        full_name: 'A Person',
        id_number: '9001015800086',
      }),
    ]);
    expect(values).toEqual({
      full_name: 'A Person',
      id_number: '9001015800086',
    });
    expect(from.id_number).toBe('IDENTITY_DOCUMENT');
  });

  it('⚠️ NEVER CARRIES THE FIREARM, THE SOURCE OR THE CASE', () => {
    // These are true of ONE application. Copying them forward would put last
    // year's answers on this year's form — a false statement on a document
    // signed under s120(9)(f), arrived at by being helpful.
    const { values } = priorReadings([
      row('CURRENT_LICENCE', '2026-01-10', { firearm_serial: 'AB123' }),
      row('FIREARM_SOURCE_PROOF', '2026-01-10', { seller_name: 'A Dealer' }),
      row('INCIDENT_REPORT', '2026-01-10', { threat_circumstances: 'x' }),
      row('SAFE_PHOTOGRAPHS', '2026-01-10', { safe_storage_detail: 'x' }),
    ]);
    expect(values).toEqual({});
  });

  it('⚠️ THE OWNED-FIREARM GRID IS THE VAULT’S JOB, NOT THIS ONE', () => {
    // credentialOffer dedupes owned-firearm rows and knows which licence each
    // came from. A second source filling the same grid would fight it, and a
    // reading has no way to tell row 1 from row 3 on an application it was
    // never part of.
    expect(CARRIES_FORWARD.has(MotivationUploadKind.CURRENT_LICENCE)).toBe(false);
  });

  it('carries only what describes the person', () => {
    for (const kind of CARRIES_FORWARD) {
      expect({
        kind,
        person: [
          'IDENTITY_DOCUMENT',
          'ADDRESS_CONFIRMATION',
          'COMPETENCY_CERTIFICATE',
          'PROFICIENCY_CERTIFICATE',
          'EMPLOYMENT_CONFIRMATION',
          'ASSOCIATION_CARD',
          'GOOD_STANDING_LETTER',
        ].includes(kind),
      }).toEqual({ kind, person: true });
    }
  });

  it('agrees with what the vault keeps, minus the safe photographs', () => {
    // Both lists answer "does this stay true past the application it arrived
    // on". They should not disagree about a document — and where they do, it
    // must be for a stated reason. VAULTABLE keeps safe photographs and the
    // shooting log because a member manages them in the Centre; neither
    // yields a FIELD, so neither carries a reading forward.
    const noReading = ['SAFE_PHOTOGRAPHS', 'SHOOTING_ACTIVITY_LOG'];
    for (const kind of CARRIES_FORWARD) {
      expect({ kind, vaultable: VAULTABLE.has(kind) }).toEqual({
        kind,
        vaultable: true,
      });
    }
    for (const kind of VAULTABLE) {
      if (noReading.includes(kind) || kind.startsWith('SAFE_')) continue;
      expect({ kind, carries: CARRIES_FORWARD.has(kind) }).toEqual({
        kind,
        carries: true,
      });
    }
  });
});

describe('⚠️ newest wins, and the order is not the query’s to decide', () => {
  it('prefers the later reading of the same field', () => {
    // A member who moved house has two address readings. The true one is the
    // later one.
    const { values } = priorReadings([
      row('ADDRESS_CONFIRMATION', '2026-06-01', {
        residential_address: '12 New Road',
      }),
      row('ADDRESS_CONFIRMATION', '2024-02-01', {
        residential_address: '3 Old Street',
      }),
    ]);
    expect(values.residential_address).toBe('12 New Road');
  });

  it('does not depend on the order it was handed', () => {
    const older = row('ADDRESS_CONFIRMATION', '2024-02-01', {
      residential_address: '3 Old Street',
    });
    const newer = row('ADDRESS_CONFIRMATION', '2026-06-01', {
      residential_address: '12 New Road',
    });
    // Sorting here rather than trusting the caller means a changed `orderBy`
    // cannot silently start serving the older address.
    expect(priorReadings([older, newer]).values).toEqual(
      priorReadings([newer, older]).values,
    );
    expect(priorReadings([older, newer]).values.residential_address).toBe(
      '12 New Road',
    );
  });
});

describe('⚠️ an empty string is not an answer', () => {
  it('does not let a blank overwrite a good older reading', () => {
    // Extraction returns '' for a field it looked for and did not find.
    const { values } = priorReadings([
      row('COMPETENCY_CERTIFICATE', '2024-01-01', {
        competency_number: 'C7276902',
      }),
      row('COMPETENCY_CERTIFICATE', '2026-01-01', { competency_number: '  ' }),
    ]);
    expect(values.competency_number).toBe('C7276902');
  });

  it('survives a row whose blob would not decrypt', () => {
    // An unreadable blob costs the prefill, not the application.
    const { values } = priorReadings([
      row('IDENTITY_DOCUMENT', '2026-01-01', null),
      row('IDENTITY_DOCUMENT', '2025-01-01', { full_name: 'A Person' }),
    ]);
    expect(values).toEqual({ full_name: 'A Person' });
  });

  it('returns nothing at all for a member with no history', () => {
    expect(priorReadings([])).toEqual({ values: {}, from: {} });
  });
});

// ────────────────────────────────────────────────────────────────────
// L7 — the date on the PAGE decides which reading is current.
// ────────────────────────────────────────────────────────────────────

describe('which of two readings is the current one', () => {
  it('⚠️ PREFERS THE DATE PRINTED ON THE DOCUMENT over when we filed it', () => {
    // The failure this fixes: a member moves house in March and only gets round
    // to photographing the OLD municipal bill in July. Sorted by createdAt the
    // stale bill is last and newest-wins adopts the address they LEFT — onto an
    // application they sign, naming where the firearm will be kept.
    const out = priorReadings([
      {
        kind: MotivationUploadKind.ADDRESS_CONFIRMATION,
        createdAt: new Date('2026-03-01T00:00:00Z'),
        values: { issue_date: '2026-03-01', residential_address: 'New place' },
      },
      {
        kind: MotivationUploadKind.ADDRESS_CONFIRMATION,
        createdAt: new Date('2026-07-01T00:00:00Z'),
        values: { issue_date: '2025-11-02', residential_address: 'Old place' },
      },
    ]);
    expect(out.values.residential_address).toBe('New place');
  });

  it('falls back to createdAt where the page carries no readable date', () => {
    // ⚠️ AND A PARTIAL DATE IS NOT A DATE. Coercing "2027" into a day would be
    // inventing the very fact being ordered on; the upload time is a weaker
    // answer than the page and a much better one than a guess.
    const out = priorReadings([
      {
        kind: MotivationUploadKind.ADDRESS_CONFIRMATION,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        values: { issue_date: '2026', residential_address: 'First' },
      },
      {
        kind: MotivationUploadKind.ADDRESS_CONFIRMATION,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        values: { residential_address: 'Second' },
      },
    ]);
    expect(out.values.residential_address).toBe('Second');
  });

  it('compares a printed date against another row’s upload time', () => {
    // The two clocks have to be comparable, or a document with a date always
    // beats one without regardless of which is actually newer.
    expect(
      effectiveDay({
        kind: MotivationUploadKind.IDENTITY_DOCUMENT,
        createdAt: new Date('2026-06-01T00:00:00Z'),
        values: { issue_date: '2019-04-04' },
      }).toISOString(),
    ).toBe('2019-04-04T00:00:00.000Z');
  });
});

// ────────────────────────────────────────────────────────────────────
// H12 — what they told us last time, on a form they signed.
// ────────────────────────────────────────────────────────────────────

describe('answers carried forward from a previous application', () => {
  const at = (iso: string, answers: Record<string, string>) => ({
    createdAt: new Date(iso),
    answers,
  });

  it('carries the history block and the safe, and nothing else', () => {
    // ⚠️ THE CUT IS THE POINT. The history questions and the safe describe the
    // PERSON and their premises; the firearm, the seller and the case being
    // made are true of ONE application, and copying them forward would put last
    // year's answers on this year's form — a false statement on a document
    // signed under s120(9)(f), arrived at by helpfulness.
    const out = priorAnswers([
      at('2026-01-01T00:00:00Z', {
        history_conviction: 'No',
        history_lost_stolen: 'Yes',
        history_lost_stolen_station: 'Bloemfontein',
        safe_type: 'SABS 953-1 Category 2',
        safe_mounted: 'Yes',
        safe_mounted_to: 'Brick wall',
        safe_storage_detail: 'Bolted through into the wall of the study.',
        // None of these may travel.
        firearm_make: 'CZ',
        firearm_serial: 'ABC123',
        motivation_reason: 'I hunt plains game every winter.',
      }),
    ]);
    expect(Object.keys(out.values).sort()).toEqual([
      'history_conviction',
      'history_lost_stolen',
      'history_lost_stolen_station',
      'safe_mounted',
      'safe_mounted_to',
      'safe_storage_detail',
      'safe_type',
    ]);
    expect(out.keys).toEqual(Object.keys(out.values));
  });

  it('⚠️ NEWEST WINS, AND THE ORDER DOES NOT COME FROM THE QUERY', () => {
    // Sorted here rather than trusted from an `orderBy`, so a change of query
    // cannot silently start serving an application from two years ago.
    const out = priorAnswers([
      at('2026-06-01T00:00:00Z', { history_conviction: 'Yes' }),
      at('2024-01-01T00:00:00Z', { history_conviction: 'No' }),
    ]);
    expect(out.values.history_conviction).toBe('Yes');
  });

  it('⚠️ AN EMPTY STRING IS NOT AN ANSWER', () => {
    // A key present and blank is a question they skipped; letting it through
    // would overwrite a good older answer with nothing.
    const out = priorAnswers([
      at('2024-01-01T00:00:00Z', { history_conviction: 'No' }),
      at('2026-06-01T00:00:00Z', { history_conviction: '   ' }),
    ]);
    expect(out.values.history_conviction).toBe('No');
  });

  it('survives an application whose answers could not be read', () => {
    const out = priorAnswers([
      { createdAt: new Date('2026-01-01T00:00:00Z'), answers: null },
      at('2026-02-01T00:00:00Z', { history_conviction: 'No' }),
    ]);
    expect(out.values.history_conviction).toBe('No');
  });

  it('covers a history key nobody has written yet', () => {
    // ⚠️ PREFIX-MATCHED ON PURPOSE. An explicit list would be right on the day
    // it was written and would silently stop covering the next question
    // somebody adds — a failure nobody would ever see, because the member just
    // retypes one more box than last time.
    expect(carriesForwardAsAnswer('history_something_added_later')).toBe(true);
    expect(carriesForwardAsAnswer('firearm_make')).toBe(false);
  });
});
