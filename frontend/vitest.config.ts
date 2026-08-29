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
    // ⚠️ NODE STAYS THE DEFAULT. The pure specs are the bulk of the suite and
    // they run in milliseconds; making everything jsdom to suit a handful of
    // component tests would tax every one of them. A component spec opts in
    // with `// @vitest-environment jsdom` on its first line, which also means
    // the file says out loud that it needs a browser.
    environment: 'node',
    include: ['lib/**/*.spec.ts', 'components/**/*.spec.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
  // ⚠️ esbuild RATHER THAN @vitejs/plugin-react, deliberately. The plugin does
  // not yet support vite 7, which this project is on, and the only thing it
  // was wanted for is the JSX transform — which esbuild does natively. One
  // line instead of a dependency that would have to be force-installed against
  // its own peer range.
  //
  // 'automatic' rather than inheriting tsconfig's "jsx": "preserve": preserve
  // is right for Next, which does its own transform, and useless here because
  // esbuild would hand the runner raw JSX.
  esbuild: { jsx: 'automatic' },
  // ⚠️ THE `@/` ALIAS, so a lib spec can reach a component's exported DATA.
  // wizard-coverage.spec.ts asserts that every registry section has a wizard
  // step, and the step list lives beside the rail that renders it — importing
  // a copy here instead would let the copy drift from the thing that ships,
  // which is exactly the failure the suite exists to catch.
  resolve: {
    alias: { '@': new URL('./', import.meta.url).pathname.replace(/^\/(\w:)/, '$1') },
  },
});
