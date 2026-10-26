import { GooglePlacesService } from './google-places.service';

// ────────────────────────────────────────────────────────────────────
// The browser Maps key cannot use Places Autocomplete (its API
// restrictions block places.googleapis.com), so the address fields call
// these methods through the backend key. These tests pin the request shape
// and the field mapping the dropdown relies on.
// ────────────────────────────────────────────────────────────────────

const originalKey = process.env.GOOGLE_MAPS_API_KEY;

function mockFetch(body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
  global.fetch = fn as never;
  return fn;
}

describe('GooglePlacesService — server-side autocomplete', () => {
  beforeAll(() => {
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  afterAll(() => {
    process.env.GOOGLE_MAPS_API_KEY = originalKey;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the place predictions for a dealer search', async () => {
    const fetchMock = mockFetch({
      suggestions: [
        {
          placePrediction: {
            placeId: 'p1',
            text: { text: 'Wildman Cape Gate, Cape Town' },
          },
        },
        { queryPrediction: { text: { text: 'ignored' } } },
      ],
    });

    const service = new GooglePlacesService();
    const out = await service.autocomplete('wildman ca', 'establishment');

    expect(out).toEqual([
      { placeId: 'p1', text: 'Wildman Cape Gate, Cape Town' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places:autocomplete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Goog-Api-Key': 'test-key' }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      input: 'wildman ca',
      includedRegionCodes: ['za'],
      includedPrimaryTypes: ['establishment'],
    });
  });

  it('does not call Google for a one-character query', async () => {
    const fetchMock = mockFetch({});
    const service = new GooglePlacesService();
    await expect(service.autocomplete('w')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a selected place into the address components the form uses', async () => {
    mockFetch({
      displayName: { text: 'Wildman Cape Gate' },
      formattedAddress: 'Wildman Cape Gate, Okavango Road, Cape Town',
      location: { latitude: -33.85, longitude: 18.7 },
      addressComponents: [
        { longText: 'Okavango Road', types: ['route'] },
        { longText: '12', types: ['street_number'] },
        { longText: 'Brackenfell', types: ['sublocality_level_1'] },
        { longText: 'Cape Town', types: ['locality'] },
        { longText: 'Western Cape', types: ['administrative_area_level_1'] },
        { longText: '7560', types: ['postal_code'] },
      ],
    });

    const service = new GooglePlacesService();
    const out = await service.address('p1');

    expect(out).toMatchObject({
      placeId: 'p1',
      name: 'Wildman Cape Gate',
      address: 'Wildman Cape Gate, Okavango Road, Cape Town',
      street: '12 Okavango Road',
      suburb: 'Brackenfell',
      city: 'Cape Town',
      province: 'Western Cape',
      postalCode: '7560',
      lat: -33.85,
      lng: 18.7,
    });
  });
});
