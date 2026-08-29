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
