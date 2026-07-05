'use client';

// UX-1f — "Get the app" install CTA for the footer.
//
// Reuses the existing PWA install plumbing (useInstallPrompt + the global
// InstallPrompt help modal that listens for `gg:show-install-help`), the same
// path the nav drawer's Install button uses. Kept as a tiny client child so
// the rest of the footer stays server-rendered. Self-hides when already
// running as the installed standalone app.

import { useInstallPrompt } from '@/lib/use-install-prompt';

export function GetTheAppCta() {
  const { canInstall, isStandalone, promptInstall } = useInstallPrompt();

  if (isStandalone) return null;

  async function handleClick() {
    if (canInstall) {
      const outcome = await promptInstall();
      if (outcome === 'unavailable') {
        window.dispatchEvent(new Event('gg:show-install-help'));
      }
    } else {
      // No captured prompt (fresh visit / iOS) → open the instruction modal.
      window.dispatchEvent(new Event('gg:show-install-help'));
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--text-primary)',
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
        borderRadius: 6,
        padding: '8px 14px',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden>📲</span>
      Get the app
    </button>
  );
}
