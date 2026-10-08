import type { PhotoChecklistItem } from '../../lib/valuation-api';

/**
 * The adaptive photo checklist. Before the category is known it shows the
 * generic four items; after identify the flow swaps in the category config's
 * checklist. Required items are marked; nothing blocks, it only guides.
 */
export function PhotoChecklist({ items }: { items: PhotoChecklistItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      className="rounded-[10px] p-4"
      style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
    >
      <p
        className="text-xs uppercase mb-3"
        style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}
      >
        Photos to include
      </p>
      <ul className="flex flex-col gap-2.5" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((item) => (
            <li key={item.tag} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 18,
                  marginTop: 1,
                  borderRadius: '50%',
                  background: item.required ? 'var(--red)' : 'var(--bg-card)',
                  border: item.required ? 'none' : '0.5px solid var(--border)',
                  flexShrink: 0,
                }}
              />
              <span className="text-sm">
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                  {item.label}
                </span>
                {item.required && (
                  <span style={{ color: 'var(--red)', marginLeft: 6, fontSize: 11 }}>
                    required
                  </span>
                )}
                <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {item.hint}
                </span>
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}
