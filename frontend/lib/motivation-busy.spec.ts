// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { setMotivationBusy } from './motivation-busy';

/**
 * The toggle hides while a motivation is busy; this module is the signal.
 * The DOM flag is what a re-mount reads on load, so both the attribute and
 * the event have to be correct.
 */
describe('setMotivationBusy', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.motivationBusy;
  });

  it('sets and clears the DOM flag', () => {
    setMotivationBusy(true);
    expect(document.documentElement.dataset.motivationBusy).toBe('true');
    setMotivationBusy(false);
    expect(document.documentElement.dataset.motivationBusy).toBeUndefined();
  });

  it('emits a window event carrying the state', () => {
    let detail: unknown = null;
    const on = (e: Event) => {
      detail = (e as CustomEvent).detail;
    };
    window.addEventListener('gg:motivation-busy', on);
    setMotivationBusy(true);
    window.removeEventListener('gg:motivation-busy', on);
    expect(detail).toBe(true);
  });
});
