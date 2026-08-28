// The footer under a wizard panel: what is still missing, then Back / Continue.
//
// Operator, 2026-08-28: "it needs to be completed before the continue turns
// red, It must also indicate which fields are still missing or required."
//
// So the button carries the state in its colour — inert grey until the step is
// genuinely complete, brand red the moment it is — and the list above it says
// what is standing in the way. A disabled button with no explanation is the
// thing this replaces: the old Continue went grey and left the seller hunting
// the panel for whichever field it disliked.
//
// ⚠️ `missing` MUST come from the same source that decides completeness.
// See stepMissing in app/listings/new/page.tsx: stepComplete is DERIVED from
// these lists, so a field can never block Continue without being named here.
// Two independent functions would drift, and the failure mode is the worst
// one available — a grey button and an empty "nothing missing" list.

interface Props {
  /** Human labels for everything still outstanding in THIS step. */
  missing: string[];
  stepNumber: number;
  totalSteps: number;
  onBack?: () => void;
  /** Omitted on the last step, where the form's own Publish button takes over. */
  onContinue?: () => void;
}

export function WizardFooter({
  missing,
  stepNumber,
  totalSteps,
  onBack,
  onContinue,
}: Props) {
  const complete = missing.length === 0;
  const isLast = stepNumber >= totalSteps;

  return (
    <div className="mt-3">
      {!complete && (
        <div
          className="rounded-[8px] px-4 py-3.5 mb-3"
          style={{
            // Amber, not red. Red is the brand's "act now" colour and is about
            // to appear on the Continue button itself; using it here too would
            // read as an error, when nothing has gone wrong — the seller has
            // simply not finished yet.
            background: 'var(--gold-wash)',
            border: '1px solid var(--gold-line)',
          }}
        >
          <p
            className="text-xs uppercase"
            style={{
              color: 'var(--gold-strong)',
              letterSpacing: '0.1em',
              fontWeight: 600,
              margin: 0,
            }}
          >
            {isLast ? 'Still needed before you can publish' : 'Still needed to continue'}
          </p>
          <ul
            className="text-sm mt-2"
            style={{
              color: 'var(--text-secondary)',
              margin: 0,
              paddingLeft: 18,
              listStyle: 'disc',
            }}
          >
            {missing.map((m) => (
              <li key={m} style={{ marginTop: 2 }}>
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3">
        {onBack && stepNumber > 1 && (
          <button
            type="button"
            onClick={onBack}
            className="px-5 py-2.5 rounded-[6px] text-sm gg-press"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            ← Back
          </button>
        )}
        {onContinue && !isLast && (
          <button
            type="button"
            onClick={onContinue}
            disabled={!complete}
            className="px-6 py-2.5 rounded-[6px] text-sm gg-press"
            style={{
              marginLeft: 'auto',
              background: complete ? 'var(--red)' : 'var(--bg-inset)',
              color: complete ? '#fff' : 'var(--text-tertiary)',
              border: complete ? 'none' : '1px solid var(--border)',
              fontWeight: 500,
              cursor: complete ? 'pointer' : 'not-allowed',
              transition: 'background-color var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out)',
            }}
          >
            Continue →
          </button>
        )}
      </div>
    </div>
  );
}
