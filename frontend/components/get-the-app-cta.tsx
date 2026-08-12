'use client';

// UX-1f — "Get the app" install CTA for the footer.
//
// Reuses the existing PWA install plumbing (useInstallPrompt + the global
// InstallPrompt help modal that listens for `gg:show-install-help`), the same
// path the nav drawer's Install button uses. Kept as a tiny client child so
// the rest of the footer stays server-rendered. Self-hides when already
// running as the installed standalone app.
//
// Pinned to the LEFT of its footer band (marginRight:auto beats the band's
// justify-content:flex-end). The bottom-right of the viewport belongs to
// Boet — his dock is `fixed` there and is ~160px wide on a phone, ~240px on
// desktop, so a right-aligned pill in the footer is sitting under the mascot
// from the moment the footer scrolls into view. See ask-gg-launcher.tsx.

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
        marginRight: 'auto',
      }}
    >
      <span aria-hidden>📲</span>
      Get the app
    </button>
  );
}
