import { defineConfig } from 'vitest/config';

// The frontend had no test runner at all before the document scanner. It has
// one now for exactly one reason: the scanner is several hundred lines of
// geometry and image processing whose output is read by a vision model, and
// "it looked right on my phone" is not a regression gate for that.
//
// NODE ENVIRONMENT, deliberately. Everything under lib/scan/ is pure — it
// takes typed arrays and returns typed arrays — so none of it needs a DOM, and
// not needing one keeps the suite fast and the dependency list short.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.spec.ts'],
  },
  // ⚠️ THE `@/` ALIAS, so a lib spec can reach a component's exported DATA.
  // wizard-coverage.spec.ts asserts that every registry section has a wizard
  // step, and the step list lives beside the rail that renders it — importing
  // a copy here instead would let the copy drift from the thing that ships,
  // which is exactly the failure the suite exists to catch.
  resolve: {
    alias: { '@': new URL('./', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
  },
});
