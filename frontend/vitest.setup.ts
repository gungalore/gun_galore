// Loaded for every spec, node and jsdom alike.
//
// ⚠️ THE MATCHERS ARE IMPORTED FOR SIDE EFFECTS. jest-dom registers
// `toBeInTheDocument` and friends on expect; a node-environment spec never
// calls them, so importing here costs those specs nothing and saves every
// component spec a line it would forget.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// ⚠️ CLEANUP IS NOT AUTOMATIC HERE, AND THE FAILURE IS CONFUSING. React
// Testing Library only registers its own afterEach when `globals: true` is
// set, which this project does not use — so without this every render piles up
// in the same document and the second test in a file fails with "Found
// multiple elements with the role button", which reads like a component bug
// rather than a harness one.
afterEach(() => {
  cleanup();
});

// ⚠️ jsdom HAS NO window.matchMedia, AND THE FAILURE DOES NOT SAY SO.
//
// `useIsPhone` (components/desk/interactions.ts) calls it inside an effect, so
// every Desk component that renders responsively — Drawer, DialogFrame, the
// shell — throws "matchMedia is not a function" from deep inside React's
// commit phase, and the stack points at react-dom rather than at the missing
// API. Stubbed here rather than per-spec so the next component spec does not
// have to rediscover it.
//
// Defaults to NOT a phone, matching useIsPhone's own server-render guess, so a
// spec that does not care about breakpoints gets the desktop tree. A spec that
// does care should override `window.matchMedia` itself and say why.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
