import { describe, expect, it } from 'vitest';
import { adoptServerAnswers } from './adopt-server-answers';

// ────────────────────────────────────────────────────────────────────
// THE CLIENT ADOPTS WHAT THE SERVER WRITES, AND NEVER THE OTHER WAY ROUND.
//
// ⚠️ THE FAILURE THIS CLOSES IS ABSORBING, WHICH IS WHY IT IS TESTED HERE
// RATHER THAN LEFT TO A SCREEN. `saveAnswers` re-derives on the way through:
// change `firearm_type` and it rewrites the competency block to the
// certificate that actually covers that firearm. The client was told nothing,
// went on holding the OLD certificate number, and posted the whole answers map
// on the next keystroke — at which point the server read the stale value as a
// change the MEMBER had made and stamped it MEMBER. MEMBER is never re-offered,
// never re-derived and never replaced, so the wrong certificate number was
// then locked onto a signed SAPS 271 (it fills g_competency_number and ticks
// g_competency_for_*) wearing a "You entered this" chip nobody earned.
//
// ⚠️ AND THE OPPOSITE MISTAKE IS JUST AS SILENT. A save takes a round trip and
// the member keeps typing through it. Merging the response over whatever is on
// screen when it lands deletes every character typed in that window. So the
// comparison is against the map that was SENT: we overwrite our own stale copy
// and never theirs.
// ────────────────────────────────────────────────────────────────────

describe('adopting what the server re-derived', () => {
  it('⚠️ TAKES THE SERVER VALUE OVER OUR OWN STALE COPY', () => {
    const sent = { firearm_type: 'Handgun', competency_number: 'RIFLE-1' };
    const next = adoptServerAnswers(sent, sent, {
      competency_number: 'HANDGUN-9',
    });
    expect(next.competency_number).toBe('HANDGUN-9');
    expect(next.firearm_type).toBe('Handgun');
  });

  it('⚠️ NEVER OVER SOMETHING TYPED DURING THE ROUND TRIP', () => {
    const sent = { competency_number: 'RIFLE-1' };
    const current = { competency_number: 'TYPED BY HAND' };
    expect(
      adoptServerAnswers(current, sent, { competency_number: 'HANDGUN-9' }),
    ).toEqual({ competency_number: 'TYPED BY HAND' });
  });

  it('clears a box the server emptied, when we still hold what we sent', () => {
    // The re-derivation empties the competency block when the new firearm is
    // covered by no certificate at all: an empty required box is a question
    // the member can answer, a wrong certificate number is one they would
    // never think to check.
    const sent = { competency_number: 'RIFLE-1', competency_expiry: '2030-01-01' };
    expect(
      adoptServerAnswers(sent, sent, {
        competency_number: '',
        competency_expiry: '',
      }),
    ).toEqual({ competency_number: '', competency_expiry: '' });
  });

  it('a key we never sent counts as empty on our side', () => {
    expect(adoptServerAnswers({}, {}, { competency_issued: '2019-03-01' })).toEqual(
      { competency_issued: '2019-03-01' },
    );
  });

  it('leaves everything the server did not mention alone', () => {
    const current = { a: '1', b: '2' };
    expect(adoptServerAnswers(current, current, { a: '1' })).toEqual(current);
  });

  it('⚠️ RETURNS THE SAME OBJECT WHEN NOTHING MOVED', () => {
    // A fresh identity on every save re-runs every useMemo and useEffect keyed
    // on `answers`, on a timer, on screens that re-derive the visible fields
    // and the whole section grouping from it.
    const current = { a: '1' };
    expect(adoptServerAnswers(current, current, { a: '1' })).toBe(current);
    expect(adoptServerAnswers(current, current, {})).toBe(current);
  });

  it('does not mutate what it was handed', () => {
    const current = { a: '1' };
    const next = adoptServerAnswers(current, current, { a: '2' });
    expect(current).toEqual({ a: '1' });
    expect(next).toEqual({ a: '2' });
  });
});
