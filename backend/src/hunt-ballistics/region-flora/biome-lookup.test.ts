/**
 * Manual smoke test for biome lookup — verifies common SA hunting
 * locations resolve to the expected biome. NOT a proper Jest spec yet;
 * we'll convert this once the rest of W3/W4 is in.
 *
 * Run from backend/:
 *   npx ts-node src/hunt-ballistics/region-flora/biome-lookup.test.ts
 */

import { BiomeLookupService } from './biome-lookup.service';

const svc = new BiomeLookupService();

type TestCase = {
  name: string;
  lat: number;
  lng: number;
  expected: string | null;
};

const TESTS: TestCase[] = [
  // Lowveld — Kruger NP central
  { name: 'Skukuza (Kruger)', lat: -24.99, lng: 31.59, expected: 'lowveld-savanna' },
  { name: 'Phalaborwa gate', lat: -23.85, lng: 31.27, expected: 'lowveld-savanna' },
  { name: 'Punda Maria (north Kruger)', lat: -22.69, lng: 31.02, expected: 'lowveld-savanna' },

  // Bushveld — Limpopo + NW + central Mpumalanga
  { name: 'Polokwane (Limpopo bushveld)', lat: -23.90, lng: 29.45, expected: 'bushveld-savanna' },
  { name: 'Thabazimbi (Waterberg)', lat: -24.59, lng: 27.41, expected: 'bushveld-savanna' },
  { name: 'Bela-Bela / Warmbaths', lat: -24.88, lng: 28.30, expected: 'bushveld-savanna' },

  // Highveld grassland
  { name: 'Bloemfontein (Free State)', lat: -29.12, lng: 26.21, expected: 'highveld-grassland' },
  { name: 'Bethlehem (E Free State)', lat: -28.23, lng: 28.31, expected: 'highveld-grassland' },
  { name: 'Ermelo (Mpumalanga grassland)', lat: -26.53, lng: 29.98, expected: 'highveld-grassland' },

  // Nama-Karoo
  { name: 'Beaufort West', lat: -32.36, lng: 22.58, expected: 'nama-karoo' },
  { name: 'Carnarvon (N Cape Karoo)', lat: -30.97, lng: 22.13, expected: 'nama-karoo' },
  { name: 'Sutherland', lat: -32.40, lng: 20.66, expected: 'nama-karoo' },

  // Succulent Karoo
  { name: 'Springbok (Namaqualand)', lat: -29.66, lng: 17.89, expected: 'succulent-karoo' },
  { name: 'Oudtshoorn (Klein Karoo)', lat: -33.59, lng: 22.20, expected: 'succulent-karoo' },

  // Kalahari
  { name: 'Upington', lat: -28.45, lng: 21.26, expected: 'kalahari-savanna' },
  { name: 'Twee Rivieren (Kgalagadi)', lat: -26.47, lng: 20.61, expected: 'kalahari-savanna' },

  // Fynbos
  { name: 'Cape Town (Table Mountain)', lat: -33.96, lng: 18.41, expected: 'fynbos' },
  { name: 'Hermanus', lat: -34.42, lng: 19.24, expected: 'fynbos' },
  { name: 'George (south coast)', lat: -33.96, lng: 22.46, expected: 'fynbos' },

  // Albany Thicket
  { name: 'Grahamstown (Makhanda)', lat: -33.31, lng: 26.52, expected: 'albany-thicket' },
  { name: 'Cradock', lat: -32.16, lng: 25.62, expected: 'albany-thicket' },

  // Indian Ocean Coastal Belt
  { name: 'Eshowe (KZN coastal hills)', lat: -28.90, lng: 31.47, expected: 'indian-ocean-coastal-belt' },
  { name: 'Port Edward (S KZN coast)', lat: -31.06, lng: 30.23, expected: 'indian-ocean-coastal-belt' },

  // Forest
  { name: 'Knysna town', lat: -34.04, lng: 23.05, expected: 'forest-knysna-tsitsikamma' },

  // Out-of-coverage (should resolve to null)
  { name: 'Nairobi (Kenya)', lat: -1.29, lng: 36.82, expected: null },
  { name: 'Windhoek (Namibia)', lat: -22.56, lng: 17.07, expected: null },
];

let passed = 0;
let failed = 0;
const failures: string[] = [];

for (const t of TESTS) {
  const got = svc.lookup(t.lat, t.lng);
  const gotId = got?.id ?? null;
  if (gotId === t.expected) {
    passed++;
    console.log(`✓ ${t.name.padEnd(40)} → ${gotId ?? 'null'}`);
  } else {
    failed++;
    const msg = `✗ ${t.name} expected ${t.expected ?? 'null'} got ${gotId ?? 'null'}`;
    failures.push(msg);
    console.log(msg);
  }
}

console.log();
console.log(`Results: ${passed}/${TESTS.length} passed`);
if (failed > 0) {
  console.log();
  console.log('Failures:');
  for (const f of failures) console.log('  ' + f);
  process.exit(1);
}
