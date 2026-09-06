'use client';

// ────────────────────────────────────────────────────────────────────
// OPENING AN AUTHENTICATED DOCUMENT IN A NEW TAB.
//
// Three separate copies of this routine existed — two in the licence pack's
// finish screen and one in the motivation wizard — and every one of them was
// written the same way for the same three reasons, each of which had already
// cost a live bug:
//
// ⚠️ THE TAB IS OPENED FIRST, SYNCHRONOUSLY. Safari's popup blocker judges
// window.open by whether it happened inside the click's own call stack.
// Opening it after an await is a blocked popup and, to the member, a View
// button that does nothing at all.
//
// ⚠️ NO 'noopener'. Per spec, window.open with noopener returns NULL — the
// flag exists precisely to sever the handle. So the blank tab opened and was
// never filled, and the fallback then navigated the CURRENT window, throwing
// away the form the member was standing in. `opener` is nulled by hand
// instead, which gets the flag's actual protection without giving up the
// handle. Safe here in a way it would not be for a foreign URL: these are
// same-origin blob: URLs we mint ourselves a line later.
//
// ⚠️ A BLOCKED POPUP BECOMES A DOWNLOAD, never a navigation. Handing the file
// over beats replacing the page they are working in.
// ────────────────────────────────────────────────────────────────────

/**
 * Mint an authenticated blob URL and show it, however the browser allows.
 *
 * `mint` runs AFTER the tab is opened and may take as long as it needs. Any
 * rejection is handed to `onError` with the tab already closed — a stranded
 * blank tab reads as a broken button.
 */
export async function openBlobTab({
  mint,
  filename,
  onError,
}: {
  mint: () => Promise<string>;
  /** Used only on the popup-blocked path, where this becomes a download. */
  filename: string;
  onError?: (e: unknown) => void;
}): Promise<void> {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const url = await mint();
    if (tab) {
      tab.location.href = url;
    } else {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
    }
    // Long enough for the tab to have loaded it. The blob is pinned until
    // then, and leaked for the life of the tab if we never let go.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    onError?.(e);
  }
}
