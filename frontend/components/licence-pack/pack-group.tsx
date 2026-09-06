'use client';

// One titled group of pack rows, with its eyebrow and optional intro.
//
// The grouping is the server's — `ChecklistSection` — and the titles carry
// meaning the screen must not restate or reorder. "What we produce" and "What
// you gather" are a promise about who does the work.

import type { ChecklistSection } from '@/lib/motivations-api';
import PackRow from './pack-row';

export default function PackGroup({
  section,
  expandedKey,
  onToggle,
}: {
  section: ChecklistSection;
  expandedKey?: string | null;
  onToggle?: (key: string) => void;
}) {
  if (!section.items.length) return null;

  return (
    <section>
      <h3 className="text-[11px] font-medium uppercase tracking-[.11em] text-[var(--text-tertiary)]">
        {section.title}
      </h3>

      {section.intro && (
        <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">
          {section.intro}
        </p>
      )}

      {/* 8px between rows, per the handoff spec. */}
      <ul className="mt-3 space-y-2">
        {section.items.map((item) => (
          <li key={item.key}>
            <PackRow
              item={item}
              expanded={expandedKey === item.key}
              onToggle={onToggle}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
