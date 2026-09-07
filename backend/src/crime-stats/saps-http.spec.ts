import {
  SAPS_INTERMEDIATE_SHA256,
  SECTIGO_OV_R36_PEM,
  intermediateFingerprint,
} from './saps-http';

describe('the Sectigo intermediate we supply for saps.gov.za', () => {
  it('is a certificate, and the one that was pinned when it was fetched', () => {
    expect(SECTIGO_OV_R36_PEM.startsWith('-----BEGIN CERTIFICATE-----')).toBe(
      true,
    );
    expect(intermediateFingerprint()).toBe(SAPS_INTERMEDIATE_SHA256);
  });
});
