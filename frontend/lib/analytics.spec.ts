import { describe, it, expect } from 'vitest';
import { isGaMeasurementId, shouldTrackGaPage } from './analytics';

// GA4 wiring guard: the measurement id must be a real-looking G- id (a
// placeholder must stay inert so a deploy can land before the property
// exists), and page_view tracking must never ship a credential URL or
// internal Desk route to Google.
describe('isGaMeasurementId', () => {
  it('accepts a GA4 web-stream id', () => {
    expect(isGaMeasurementId('G-ABCDE12345')).toBe(true);
  });
  it('rejects absent, blank, placeholder or truncated values', () => {
    expect(isGaMeasurementId(undefined)).toBe(false);
    expect(isGaMeasurementId('')).toBe(false);
    expect(isGaMeasurementId('   ')).toBe(false);
    expect(isGaMeasurementId('G-')).toBe(false);
    expect(isGaMeasurementId('G-XXXX')).toBe(false);
    expect(isGaMeasurementId('UA-1234-1')).toBe(false);
    expect(isGaMeasurementId('placeholder')).toBe(false);
  });
});

describe('shouldTrackGaPage', () => {
  it('tracks public pages', () => {
    expect(shouldTrackGaPage('/')).toBe(true);
    expect(shouldTrackGaPage('/listings/abc')).toBe(true);
    expect(shouldTrackGaPage('/gate')).toBe(true);
    expect(shouldTrackGaPage('/community')).toBe(true);
  });
  it('never tracks the internal Desk', () => {
    expect(shouldTrackGaPage('/admin')).toBe(false);
    expect(shouldTrackGaPage('/admin/operate')).toBe(false);
  });
  it('never tracks credential-in-URL action links or APIs', () => {
    expect(shouldTrackGaPage('/a')).toBe(false);
    expect(shouldTrackGaPage('/a/TOKEN123')).toBe(false);
    expect(shouldTrackGaPage('/api/listings')).toBe(false);
  });
  it('rejects junk', () => {
    expect(shouldTrackGaPage('')).toBe(false);
    expect(shouldTrackGaPage(undefined)).toBe(false);
    expect(shouldTrackGaPage('https://example.com')).toBe(false);
  });
});
