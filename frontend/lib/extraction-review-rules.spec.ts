import { describe, expect, it } from 'vitest';
import type { Suggestion } from './motivations-api';
import { acceptedFrom, defaultTicks, mergeReads } from './extraction-review-rules';

// ────────────────────────────────────────────────────────────────────
// WHAT A DOCUMENT READING MAY DO WITHOUT ASKING.
//
// The rebuilt wizard shipped discarding every reading it paid for, so these
// rules had nowhere to live and nothing asserting them. They are the safety
// argument for reading somebody's documents at all: the server refuses to
// write a suggestion itself because a misread digit would become a false
// statement on a form signed under s120(9)(f), and these keep that true on
// the client.
// ────────────────────────────────────────────────────────────────────

const sg = (over: Partial<Suggestion> & { key: string }): Suggestion => ({
  value: 'v',
  label: 'L',
  from: 'your identity document',
  trusted: true,
  ...over,
});

describe('⚠️ a doubted value arrives unticked', () => {
  // `trusted: false` is not "slightly less sure" — it means our own checks
  // disagree with what was read. The old panel rendered those identically to
  // confident ones and took the lot on one button.

  it('ticks what we are confident about', () => {
    expect(defaultTicks([sg({ key: 'a' }), sg({ key: 'b' })])).toEqual({
      a: true,
      b: true,
    });
  });

  it('⚠️ LEAVES A DOUBTED READING FOR THE MEMBER TO TICK', () => {
    const ticks = defaultTicks([
      sg({ key: 'id_number' }),
      sg({ key: 'firearm_serial', trusted: false }),
    ]);
    expect(ticks).toEqual({ id_number: true, firearm_serial: false });
  });

  it('treats a missing trusted flag as doubted, never as trusted', () => {
    // A server that stops sending the flag must fail closed. `undefined` is
    // not `true`.
    const loose = { key: 'x', value: 'v', label: 'L', from: 'f' } as Suggestion;
    expect(defaultTicks([loose])).toEqual({ x: false });
  });
});

describe('⚠️ only what was ticked is written', () => {
  const three = [
    sg({ key: 'a', value: '1' }),
    sg({ key: 'b', value: '2' }),
    sg({ key: 'c', value: '3', trusted: false }),
  ];

  it('writes the ticked lines and nothing else', () => {
    expect(acceptedFrom(three, { a: true, b: false, c: true })).toEqual({
      a: '1',
      c: '3',
    });
  });

  it('⚠️ A MEMBER CAN REJECT ONE WRONG DIGIT WITHOUT LOSING THE REST', () => {
    // The old panel was all-or-nothing, so spotting one bad value meant
    // retyping every good one. Nobody retypes six values.
    const kept = acceptedFrom(three, { a: true, b: true, c: false });
    expect(Object.keys(kept)).toEqual(['a', 'b']);
    expect(kept).not.toHaveProperty('c');
  });

  it('writes nothing when nothing is ticked', () => {
    expect(acceptedFrom(three, {})).toEqual({});
    expect(acceptedFrom(three, { a: false, b: false, c: false })).toEqual({});
  });

  it('⚠️ A KEY IT HAS NEVER SEEN COUNTS AS UNTICKED', () => {
    // A suggestion arriving after the tick state was built must not be
    // written by default — the member has not looked at it.
    expect(acceptedFrom([sg({ key: 'late' })], { other: true })).toEqual({});
  });

  it('never invents a value the suggestion did not carry', () => {
    const out = acceptedFrom([sg({ key: 'a', value: '' })], { a: true });
    expect(out).toEqual({ a: '' });
  });
});

describe('⚠️ two photographs of one card offer one line', () => {
  it('replaces an earlier reading of the same field', () => {
    // Photographing twice because of glare is the ordinary case. Two
    // contradictory lines with no way to tell which is current is not.
    const merged = mergeReads(
      [sg({ key: 'serial', value: 'AB123' })],
      [sg({ key: 'serial', value: 'AB128' })],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('AB128');
  });

  it('keeps the order it already had, so the panel does not reshuffle', () => {
    const merged = mergeReads(
      [sg({ key: 'a' }), sg({ key: 'b' })],
      [sg({ key: 'b', value: 'new' }), sg({ key: 'c' })],
    );
    expect(merged.map((m) => m.key)).toEqual(['a', 'b', 'c']);
    expect(merged[1].value).toBe('new');
  });

  it('carries the newer trust flag with the newer value', () => {
    // A re-read that our checks now doubt must not keep the old line's tick.
    const merged = mergeReads(
      [sg({ key: 'serial', trusted: true })],
      [sg({ key: 'serial', value: 'x', trusted: false })],
    );
    expect(defaultTicks(merged)).toEqual({ serial: false });
  });

  it('leaves both lists alone', () => {
    const a = [sg({ key: 'a' })];
    const b = [sg({ key: 'b' })];
    mergeReads(a, b);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('the three rules together', () => {
  it('⚠️ A DISTRACTED TAP CANNOT WRITE A VALUE WE ALREADY DOUBT', () => {
    // The whole chain, as the panel runs it: read arrives, ticks default,
    // member taps accept without changing anything.
    const read = mergeReads(
      [],
      [
        sg({ key: 'id_number', value: '9001015800086' }),
        sg({ key: 'firearm_serial', value: '???', trusted: false }),
      ],
    );
    const written = acceptedFrom(read, defaultTicks(read));
    expect(written).toEqual({ id_number: '9001015800086' });
    expect(written).not.toHaveProperty('firearm_serial');
  });
});
