import type { Metadata } from 'next';

/**
 * THE BENCH — the module's shell.
 *
 * The stylesheet is imported HERE rather than in the page, following the Desk
 * (app/admin/desk/layout.tsx): a layout imports once for the whole subtree,
 * where a client page re-declares the dependency on every route inside it.
 */
import '../../components/bench/bench.css';

export const metadata: Metadata = {
  title: 'The Bench',
  description:
    'Find the loads you can actually make from the powders, bullets and cartridges on your bench.',
};

export default function BenchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
