// ────────────────────────────────────────────────────────────────────
// TURNING THE SCANNER'S DIAGNOSTIC READOUT ON.
//
// Same shape as lib/licence-services-preview.ts, deliberately — that is the
// only developer toggle this frontend has, so it is the house pattern: an
// exact `=1` match in the query string, remembered in sessionStorage so it
// survives navigation within the tab, every storage touch wrapped in a catch
// that returns false rather than throwing, and a paired way out.
//
// ⚠️ sessionStorage, NOT localStorage. A diagnostic readout should end when
// the tab does. Nobody should find their scanner covered in numbers next week
// and have no idea how it got that way.
//
// ⚠️ NOT A SECURITY CONTROL, AND IT COULD NOT BE ONE. Everything it reveals is
// a measurement of the viewer's own camera frame — the same numbers the
// scanner already acts on. It changes which UI you get, never what data you
// may see.
//
// ⚠️ AND NO BUILD FLAG. The preview toggle pairs with
// NEXT_PUBLIC_LICENCE_SERVICES_ENABLED because that screen was meant to ship
// to everybody eventually. This one never is: a diagnostic overlay is for the
// person holding the phone while somebody debugs it, so the URL is the only
// way in and there is nothing to switch on later.
// ────────────────────────────────────────────────────────────────────

const KEY = 'scan-diagnostics';

/**
 * Is the readout on for this tab?
 *
 * Takes the raw query string rather than reading `window.location` itself, so
 * it can be tested without a DOM — the same reason the preview toggle does.
 *
 * ⚠️ NEVER THROWS. sessionStorage throws on ACCESS wherever site data is
 * blocked, not merely on write, and every caller of this is a page load.
 */
export function diagnosticsOn(search?: string): boolean {
  try {
    if (search && new URLSearchParams(search).get('diag') === '1') {
      sessionStorage.setItem(KEY, '1');
      return true;
    }
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Turn it off again, for the readout's own close button. */
export function clearDiagnostics(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* see above */
  }
}

/**
 * Add the opt-in to a phone hand-off URL.
 *
 * ⚠️ THE PHONE CANNOT TYPE A QUERY STRING. The scanner that needs debugging
 * most is the one on the phone, and it is opened by scanning a QR code — so
 * the only practical way to switch the readout on over there is for the
 * desktop to build it into the link before the code is drawn.
 */
export function withDiagnostics(url: string, on: boolean): string {
  if (!on) return url;
  return url.includes('diag=1')
    ? url
    : `${url}${url.includes('?') ? '&' : '?'}diag=1`;
}
