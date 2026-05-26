// frontend/lib/ballistics-data/rifles.ts
//
// Common rifle presets — twist rate + scope-height defaults for
// instant profile creation. Used by the profile picker so a user
// who selects "Tikka T3x .308" gets reasonable defaults pre-filled
// instead of having to look up factory specs.
//
// Twist rate: written as "1:N" inches. We store the N as a number
// for math (e.g. for Greenhill stability calc later) but display as
// "1:N".
//
// Scope height: bore-to-optical-centre measured at the eyepiece.
// 4 cm is a sane AR/bolt-rifle default. Lower for pistols (~1.5cm)
// because the optic sits much closer.
//
// SA-specific bias: CZ, BRNO, Sako, Tikka, Howa, Ruger feature more
// prominently than US-only brands.

export interface RiflePreset {
  /** Display name as it'd appear on a profile chip. */
  name: string;
  /** Aliases for fuzzy search. */
  aliases: string[];
  manufacturer: string;
  /** Canonical SA hunting calibre this preset targets. */
  calibre: string;
  /** Twist rate (denominator of 1:N inches). 10 = 1-in-10". */
  twistInchesDenom: number;
  /** Sight/scope optical centre above bore, cm. */
  scopeHeightCm: number;
  /** Default zero in metres. */
  defaultZeroM: number;
  /** Free-text note shown in the profile editor. */
  note?: string;
}

export const RIFLE_PRESETS: RiflePreset[] = [
  {
    name: 'CZ 550 American .308 Win',
    aliases: ['cz 550', 'cz550 308'],
    manufacturer: 'CZ',
    calibre: '.308 Win',
    twistInchesDenom: 12,
    scopeHeightCm: 4.5,
    defaultZeroM: 100,
    note: 'Classic SA bolt rifle. 1:12 twist suits 150-180 gr loads.',
  },
  {
    name: 'CZ 557 Sporter 6.5 Creedmoor',
    aliases: ['cz 557', 'cz557 65 cm'],
    manufacturer: 'CZ',
    calibre: '6.5 Creedmoor',
    twistInchesDenom: 8,
    scopeHeightCm: 4.5,
    defaultZeroM: 100,
    note: '1:8 — stabilises heavy 140-147 gr match bullets.',
  },
  {
    name: 'BRNO ZKK 600 .30-06',
    aliases: ['brno zkk 600', 'zkk 600 30-06'],
    manufacturer: 'BRNO',
    calibre: '.30-06 Spring',
    twistInchesDenom: 10,
    scopeHeightCm: 4.5,
    defaultZeroM: 100,
    note: 'Solid pre-CZ classic — common SA hunting rifle.',
  },
  {
    name: 'BRNO ZKK 602 .375 H&H',
    aliases: ['zkk 602', 'brno 375'],
    manufacturer: 'BRNO',
    calibre: '.375 H&H',
    twistInchesDenom: 12,
    scopeHeightCm: 5,
    defaultZeroM: 75,
    note: 'Dangerous-game classic. Short zero for thicket shots.',
  },
  {
    name: 'Tikka T3x Lite .308 Win',
    aliases: ['tikka t3x', 't3x 308'],
    manufacturer: 'Tikka',
    calibre: '.308 Win',
    twistInchesDenom: 11,
    scopeHeightCm: 4,
    defaultZeroM: 100,
    note: '1:11 — good for 150-180 gr. Light hunter.',
  },
  {
    name: 'Tikka T3x CTR 6.5 Creedmoor',
    aliases: ['tikka ctr', 't3x ctr 6.5'],
    manufacturer: 'Tikka',
    calibre: '6.5 Creedmoor',
    twistInchesDenom: 8,
    scopeHeightCm: 4.5,
    defaultZeroM: 100,
  },
  {
    name: 'Sako 85 Hunter 7mm Rem Mag',
    aliases: ['sako 85', 'sako 7mm rm'],
    manufacturer: 'Sako',
    calibre: '7mm Rem Mag',
    twistInchesDenom: 9.5,
    scopeHeightCm: 4.5,
    defaultZeroM: 150,
    note: '1:9.5 spins long 160-180 gr match/hunting projectiles well.',
  },
  {
    name: 'Howa 1500 .308 Win',
    aliases: ['howa 1500', 'howa 308'],
    manufacturer: 'Howa',
    calibre: '.308 Win',
    twistInchesDenom: 12,
    scopeHeightCm: 4,
    defaultZeroM: 100,
  },
  {
    name: 'Ruger M77 Hawkeye .30-06',
    aliases: ['ruger m77', 'm77 30-06'],
    manufacturer: 'Ruger',
    calibre: '.30-06 Spring',
    twistInchesDenom: 10,
    scopeHeightCm: 4.5,
    defaultZeroM: 100,
  },
  {
    name: 'Remington 700 SPS .223 Rem',
    aliases: ['rem 700', 'remington 700 223'],
    manufacturer: 'Remington',
    calibre: '.223 Rem',
    twistInchesDenom: 9,
    scopeHeightCm: 4,
    defaultZeroM: 100,
    note: '1:9 stabilises 55-77 gr match bullets.',
  },
  {
    name: 'Vektor R5 5.56 NATO',
    aliases: ['vektor r5', 'r5'],
    manufacturer: 'Vektor (Lyttelton/Denel)',
    calibre: '5.56 NATO',
    twistInchesDenom: 12,
    scopeHeightCm: 6.5,
    defaultZeroM: 100,
    note:
      'AR-style — taller red-dot/optic stack. Heritage SA service rifle.',
  },
];

export function findRiflePreset(query: string): RiflePreset | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  for (const r of RIFLE_PRESETS) {
    if (r.aliases.includes(q)) return r;
  }
  for (const r of RIFLE_PRESETS) {
    if (r.aliases.some((a) => a.includes(q)) || r.name.toLowerCase().includes(q))
      return r;
  }
  return null;
}
