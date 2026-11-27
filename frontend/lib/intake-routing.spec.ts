import { describe, expect, it } from 'vitest';
import { interviewRedirectFor, startRedirectFor } from './intake-routing';

// ⚠️ THE MID-INTERVIEW RESUME CASE IS THE POINT. The operator's live application
// (MO000159) was bounced from the interview to the pack screen after reload; both
// directions are pinned here so that cannot come back silently.
describe('the interview screen’s routing', () => {
  it('sends a pre-interview state back to the start screen', () => {
    expect(interviewRedirectFor('mo1', 'MODE', false)).toBe(
      '/licence-centre/mo1/start',
    );
    expect(interviewRedirectFor('mo1', 'DOCUMENTS', undefined)).toBe(
      '/licence-centre/mo1/start',
    );
  });

  it('renders the interview itself', () => {
    expect(interviewRedirectFor('mo1', 'INTERVIEW', false)).toBeNull();
    expect(interviewRedirectFor('mo1', 'INTERVIEW', undefined)).toBeNull();
    expect(interviewRedirectFor('mo1', 'BLOCKED', false)).toBeNull();
  });

  it('only leaves a FINISHED review for the review screen', () => {
    expect(interviewRedirectFor('mo1', 'REVIEW', true)).toBe(
      '/licence-centre/mo1',
    );
    // Not finished: keep the completion card so the member presses the button.
    expect(interviewRedirectFor('mo1', 'REVIEW', false)).toBeNull();
    expect(interviewRedirectFor('mo1', 'REVIEW', undefined)).toBeNull();
  });
});

describe('the start screen’s routing', () => {
  it('resumes a mid-interview application in the interview', () => {
    expect(startRedirectFor('mo1', 'INTERVIEW', false)).toBe(
      '/licence-centre/mo1/interview',
    );
  });

  it('sends an unfinished REVIEW back to the interview, never the pack', () => {
    expect(startRedirectFor('mo1', 'REVIEW', false)).toBe(
      '/licence-centre/mo1/interview',
    );
    expect(startRedirectFor('mo1', 'REVIEW', undefined)).toBe(
      '/licence-centre/mo1/interview',
    );
  });

  it('sends a finished application to the review screen', () => {
    expect(startRedirectFor('mo1', 'REVIEW', true)).toBe('/licence-centre/mo1');
  });

  it('renders the start screen for the states it owns', () => {
    expect(startRedirectFor('mo1', 'MODE', false)).toBeNull();
    expect(startRedirectFor('mo1', 'DOCUMENTS', false)).toBeNull();
    expect(startRedirectFor('mo1', 'BLOCKED', false)).toBeNull();
  });
});
