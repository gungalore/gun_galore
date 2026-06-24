// Shared header used by every legal document — gives each doc the
// same look (title + last-updated date). Centralised so a wording
// change only has to touch one place.

interface Props {
  title: string;
  lastUpdated: string; // free-form date string, e.g. "Effective 24 June 2026"
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
    </>
  );
}
