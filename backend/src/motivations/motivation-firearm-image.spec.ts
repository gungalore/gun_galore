import {
  firearmImageKey,
  plausiblyShows,
  scoreTitle,
} from './motivation-firearm-image';

// ────────────────────────────────────────────────────────────────────
// THIS FILE EXISTS BECAUSE THE FIRST VERSION SHIPPED A PHOTOGRAPH OF AN
// ASSAULT RIFLE.
//
// The original fetch fell back to searching the manufacturer alone, reasoning
// that a photograph of the right family of firearm beats a blank frame. Run
// against real data it stored "Type 89 Assault Rifle JGSDF" under the name of
// a Howa 1500 — Howa builds the Type 89 for the Japan Ground Self-Defense
// Force, so it is a genuine Howa and a genuinely correct search result. It
// would have gone on the cover of a firearm licence application, captioned as
// the applicant's own bolt-action hunting rifle, addressed to the Registrar.
//
// Nothing about that was a coding error. It was a wrong idea, and only real
// data exposed it. These tests keep the corrected idea in place: the picture
// must be of the model named in the caption, or there is no picture.
// ────────────────────────────────────────────────────────────────────

describe('firearmImageKey', () => {
  it('keys on make and model, never on a serial', () => {
    expect(firearmImageKey('Tikka', 'T3')).toBe('tikka-t3');
    expect(firearmImageKey('Česká zbrojovka', '75 B')).toBe('ceska-zbrojovka-75-b');
    // Two applicants with the same model share one file. That is the point:
    // it is a picture of the TYPE. A serial in the key would store an
    // identical image per applicant and turn a shared asset into a per-person
    // record, with every retention question that brings.
    expect(firearmImageKey('Glock', '19')).toBe(
      firearmImageKey('GLOCK', '19'),
    );
  });

  it('refuses a key too short to mean anything', () => {
    expect(firearmImageKey('', '')).toBeNull();
    expect(firearmImageKey('-', '-')).toBeNull();
  });
});

describe('plausiblyShows', () => {
  it('refuses the assault rifle that shipped', () => {
    // ⚠️ THE REGRESSION THIS FILE IS NAMED FOR. Verified against the real
    // Commons response, not a hypothetical one.
    expect(
      plausiblyShows('File:Type 89 Assault Rifle JGSDF.jpg', 'Howa', '1500'),
    ).toBe(false);
  });

  it('refuses an event photograph that merely mentions the right world', () => {
    // What "Beretta 686" actually returned: a picture from a hunting fair,
    // with no identifiable firearm in the title at all.
    expect(
      plausiblyShows('File:Jagen und Fischen 2017 (07).jpg', 'Beretta', '686'),
    ).toBe(false);
  });

  it('refuses a different model from the same maker', () => {
    expect(plausiblyShows('File:Glock 17 Gen4.jpg', 'Glock', '19')).toBe(false);
  });

  it('accepts the right firearm however the title punctuates it', () => {
    expect(plausiblyShows('File:1977 CZ-75.png', 'CZ', '75')).toBe(true);
    expect(plausiblyShows('File:Glock19-1.jpg', 'Glock', '19')).toBe(true);
    // ⚠️ MAKE AND MODEL ARE MATCHED SEPARATELY, and this is why. A rule
    // demanding the literal run "howa1500" would throw away a photograph
    // titled "Howa Model 1500" — which is exactly the firearm asked for.
    expect(plausiblyShows('File:Howa Model 1500 rifle.jpg', 'Howa', '1500')).toBe(
      true,
    );
  });

  it('accepts on any word of a make that is written several ways', () => {
    // "Česká zbrojovka", "Ceska Zbrojovka (CZ)" and "CZ" are the same company
    // and applicants type all three.
    expect(
      plausiblyShows('File:1977 CZ-75.png', 'Ceska Zbrojovka (CZ)', '75'),
    ).toBe(true);
  });

  it('refuses when there is nothing to check against', () => {
    expect(plausiblyShows('File:Anything.jpg', 'Howa', '')).toBe(false);
    expect(plausiblyShows('', 'Howa', '1500')).toBe(false);
  });
});

describe('scoreTitle', () => {
  it('prefers a plain product photograph to a service one', () => {
    // Both are genuinely a Tikka T3 — the guard passes both. This is what
    // decides WHICH photograph of the applicant's own rifle goes on a hunting
    // licence application.
    expect(scoreTitle('File:Tikka-T3-Sporter.jpg')).toBeLessThan(
      scoreTitle(
        'File:SAKO TIKKA T3 TAC 7.62x51 Bolt Action Sniper Rifle of Indian Navy MARCOS.jpg',
      ),
    );
  });

  it('penalises, and does not exclude', () => {
    // ⚠️ A PREFERENCE, NOT A FILTER. If the only photograph Commons holds of
    // the applicant's model is a service one, that is still their model and
    // still better than an empty frame. Nothing here can return "reject".
    expect(scoreTitle('File:Some Army Rifle.jpg')).toBeGreaterThan(0);
    expect(Number.isFinite(scoreTitle('File:Some Army Rifle.jpg'))).toBe(true);
  });

  it('matches whole words only', () => {
    // Without word boundaries "war" matches "Warthog" and every plains-game
    // photograph in the collection gets penalised for existing.
    expect(scoreTitle('File:Warthog.jpg')).toBeLessThan(200);
    expect(scoreTitle('File:Armyworm.jpg')).toBeLessThan(200);
    expect(scoreTitle('File:Army rifle.jpg')).toBeGreaterThan(200);
  });
});
