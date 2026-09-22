'use client';

import { useEffect, useState } from 'react';

/**
 * A tiny global "a motivation is busy" signal.
 *
 * The motivation sheet's own `busy` state (saving / generating) is the only
 * thing that should hide the always-on Shop/Community toggle — switching views
 * mid-save would yank the member out of an in-flight action. Reported as a
 * DOM attribute + window event so the toggle (a sibling in the nav) can react
 * without prop-drilling or context.
 */

const EVENT = 'gg:motivation-busy';
const ATTR = 'motivationBusy';

function read(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.dataset[ATTR] === 'true';
}

/** Called by the motivation sheet. */
export function setMotivationBusy(busy: boolean): void {
  if (typeof document === 'undefined') return;
  if (busy) document.documentElement.dataset[ATTR] = 'true';
  else delete document.documentElement.dataset[ATTR];
  window.dispatchEvent(new CustomEvent(EVENT, { detail: busy }));
}

/**
 * Report a motivation's busy state for as long as the value holds (and clear
 * it on unmount), so navigating away can never leave the toggle hidden.
 */
export function useReportMotivationBusy(busy: boolean): void {
  useEffect(() => {
    setMotivationBusy(busy);
    return () => setMotivationBusy(false);
  }, [busy]);
}

/** Subscribe to the busy signal. */
export function useMotivationBusy(): boolean {
  const [busy, setBusy] = useState(read);
  useEffect(() => {
    const onChange = (e: Event) => setBusy(!!(e as CustomEvent).detail);
    window.addEventListener(EVENT, onChange);
    setBusy(read());
    return () => window.removeEventListener(EVENT, onChange);
  }, []);
  return busy;
}
