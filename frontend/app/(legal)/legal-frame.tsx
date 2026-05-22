// Shared header used by every legal document — gives each doc the
// same look (title + last-updated date + amber "pending legal review"
// banner). Centralised so a future review-sign-off only has to flip
// one prop in one place.

interface Props {
  title: string;
  lastUpdated: string; // free-form date string, e.g. "pre-launch · v0.1 draft"
}

export function LegalDocHeader({ title, lastUpdated }: Props) {
  return (
    <>
      <h1 style={{ fontSize: 28, fontWeight: 500, marginBottom: 8 }}>
        {title}
      </h1>
      <p
        style={{
          color: 'var(--text-tertiary)',
          fontSize: 13,
          marginBottom: 24,
        }}
      >
        Last updated: {lastUpdated}
      </p>
      <div
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '0.5px solid #f59e0b',
          borderRadius: 8,
          padding: 16,
          marginBottom: 32,
          fontSize: 13,
          color: 'var(--text-secondary)',
        }}
      >
        <strong style={{ color: '#f59e0b' }}>Draft notice.</strong> This
        document has been drafted with reference to South African law (the
        Electronic Communications and Transactions Act 25 of 2002, the
        Consumer Protection Act 68 of 2008, the Protection of Personal
        Information Act 4 of 2013, the Firearms Control Act 60 of 2000
        and related regulations) and is intended to be near-final, but
        binding language must be reviewed and signed off by a qualified
        South African attorney before public launch. By using GunGalore
        during the closed-beta period, you agree to be bound by the
        version of this document in force when you registered.
      </div>
    </>
  );
}
