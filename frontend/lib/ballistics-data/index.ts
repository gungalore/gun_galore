// frontend/lib/ballistics-data/index.ts
//
// Public surface for the offline ballistic-data bundle. Imported by
// the calculator app's hooks + the AI Lookup card. ~3-5 KB minified
// (the heavyweight item is the bullet table) — fits well inside the
// PWA precache budget.

export * from './bullets';
export * from './sa-game';
export * from './rifles';
