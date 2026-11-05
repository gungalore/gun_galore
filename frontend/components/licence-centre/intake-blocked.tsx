'use client';

import type { IntakeBlocked as Blocked } from '@/lib/motivations-api';

/**
 * A firearm the chosen section cannot license is not a quality problem and not
 * a question to keep asking. Show the statutory reason and the sections that
 * WOULD take it, and keep the applicant's answers when they switch.
 */
export default function IntakeBlocked({
  blocked,
  busy,
  onSwitch,
}: {
  blocked: Blocked;
  busy: boolean;
  onSwitch: (licenceType: string) => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-5">
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--red)', background: 'var(--red-wash)' }}
      >
        <p className="m-0 text-[12px] uppercase tracking-[0.12em] text-[var(--red)]">
          This firearm cannot go under this section
        </p>
        <p className="mt-2 text-[14px] leading-6 text-[var(--text-primary)]">
          {blocked.message}
        </p>
        <p className="mt-2 text-[12.5px] leading-5 text-[var(--text-secondary)]">
          Switching keeps the answers and documents already on this application.
          Nothing is lost.
        </p>
      </div>

      {blocked.suggested.length ? (
        <div className="mt-4 grid gap-2">
          {blocked.suggested.map((s) => (
            <button
              key={s.licenceType}
              type="button"
              disabled={busy}
              onClick={() => onSwitch(s.licenceType)}
              className="rounded-lg border px-3 py-3 text-left text-[13.5px] font-medium disabled:opacity-50"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
              }}
            >
              Move this application to {s.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-[var(--text-secondary)]">
          Start a new application from your Licence Centre with the right
          section for this firearm.
        </p>
      )}

      <a
        href="/licence-centre/applications"
        className="mt-4 inline-block text-[13px] text-[var(--text-secondary)] underline"
      >
        Back to my applications
      </a>
    </main>
  );
}
