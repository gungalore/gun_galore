/**
 * Legal conditions for regulated categories, shown before the ad step. The
 * messages come from the category config (operator-owned). No statute
 * citations appear anywhere.
 */
export function LegalFlagsCard({
  flags,
}: {
  flags: Array<{ flag: string; message: string }>;
}) {
  if (!flags.length) return null;
  return (
    <div
      className="rounded-[10px] p-4"
      style={{ background: 'rgba(227,6,19,0.06)', border: '0.5px solid rgba(227,6,19,0.3)' }}
    >
      <p className="text-sm font-semibold mb-2" style={{ color: 'var(--red)' }}>
        Before you list this item
      </p>
      <ul className="flex flex-col gap-2" style={{ margin: 0, paddingLeft: 18 }}>
        {flags.map((f) => (
          <li key={f.flag} className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {f.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
