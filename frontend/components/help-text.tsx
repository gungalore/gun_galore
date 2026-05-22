// Always-visible inline hint. Drop below form labels, beside status
// pills, or under action buttons to explain what something does or
// what the user is about to commit to.
//
// Formalises the ad-hoc pattern we'd been using inline in the Sell
// flow's <Field> component — a single grey-tertiary 12px paragraph —
// so the whole site can call <HelpText> instead of re-styling each
// time.

export function HelpText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-xs mt-1 ${className ?? ''}`}
      style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
    >
      {children}
    </p>
  );
}
