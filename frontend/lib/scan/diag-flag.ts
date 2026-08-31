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

// ────────────────────────────────────────────────────────────────────
// THE SAVE TOOL OUTLIVES THE READOUT, DELIBERATELY.
//
// ⚠️ A DEBUGGING AID THAT VANISHES MID-SESSION IS WORSE THAN NONE. The readout
// is noise you want gone by next week, so sessionStorage is right for it. The
// save button is a TOOL you are holding while working, and three ordinary
// things end a phone session without warning: closing the tab, iOS evicting a
// backgrounded one, and launching the PWA fresh from the home screen. The
// operator lost it partway through scanning a set and could not get it back —
// the button disappeared out of their hand between one document and the next.
//
// So this one is localStorage, and it has its own explicit way out rather than
// relying on the session ending.
// ────────────────────────────────────────────────────────────────────

const SAVE_KEY = 'scan-save-to-phone';

/** May the review screen offer the file to the phone? */
export function saveToPhoneOn(search?: string): boolean {
  try {
    const q = search ? new URLSearchParams(search) : null;
    // `diag=1` turns both on, so one URL still does what it always did.
    if (q?.get('save') === '0') {
      localStorage.removeItem(SAVE_KEY);
      return false;
    }
    if (q?.get('diag') === '1' || q?.get('save') === '1') {
      localStorage.setItem(SAVE_KEY, '1');
      return true;
    }
    return localStorage.getItem(SAVE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Put it away. `?save=0` does the same from a URL. */
export function clearSaveToPhone(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* see above */
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
