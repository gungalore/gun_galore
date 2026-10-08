'use client';

import { useState } from 'react';

/** The ready-to-post ad. Serial-like identifiers are already redacted by the backend. */
export function AdPreviewCard({
  ad,
}: {
  ad: { title: string; bullets: string[]; priceZar: number; description?: string | null };
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    const text = `${ad.title}\n\n${ad.bullets.map((b) => `- ${b}`).join('\n')}\n\nR${ad.priceZar.toLocaleString('en-ZA')}`;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  }

  return (
    <div
      className="rounded-[10px] p-4"
      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
          {ad.title}
        </p>
        <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--red)' }}>
          R{ad.priceZar.toLocaleString('en-ZA')}
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5" style={{ margin: 0, paddingLeft: 18 }}>
        {ad.bullets.map((b, i) => (
          <li key={i} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {b}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={copy}
        className="mt-4 rounded-[6px] px-3 py-1.5 text-xs font-medium"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '0.5px solid var(--border)', cursor: 'pointer' }}
      >
        {copied ? 'Copied' : 'Copy ad text'}
      </button>
    </div>
  );
}
