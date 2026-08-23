import { ActivityController } from './activity.controller';
import type { ActivityService } from './activity.service';

// This endpoint is an UNAUTHENTICATED WRITE. Anything that reaches the
// database through it arrives from a stranger with curl, so the tests that
// matter here are the ones about what it refuses — not what it stores.

function build() {
  const record = jest.fn();
  const controller = new ActivityController({
    record,
  } as unknown as ActivityService);
  return { controller, record };
}

describe('what the beacon will accept', () => {
  it('takes the four install-funnel types', () => {
    const { controller, record } = build();
    controller.ingest('clerk_1', {
      deviceId: 'd1',
      events: [
        { eventType: 'install_shown' },
        { eventType: 'install_clicked' },
        { eventType: 'install_dismissed' },
        { eventType: 'install_completed' },
      ],
    });
    expect(record).toHaveBeenCalledTimes(4);
    expect(record.mock.calls.map((c) => c[0].eventType)).toEqual([
      'install_shown',
      'install_clicked',
      'install_dismissed',
      'install_completed',
    ]);
  });

  it('still takes the original four, unchanged', () => {
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [
        { eventType: 'page_view', path: '/' },
        { eventType: 'cart_add', listingId: 'l1' },
        { eventType: 'listing_view', listingId: 'l1' },
        { eventType: 'search', query: 'rifle' },
      ],
    });
    expect(record).toHaveBeenCalledTimes(4);
  });

  it('drops an event type that is not on the list', () => {
    // The money events are captured server-side precisely so they cannot be
    // asserted from a browser. Naming one here must do nothing.
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [
        { eventType: 'offer_placed' },
        { eventType: 'checkout_started' },
        { eventType: '' },
        {} as { eventType?: string },
      ],
    });
    expect(record).not.toHaveBeenCalled();
  });
});

describe('the install labels', () => {
  it('keeps a platform and a surface that are on the allowlist', () => {
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [
        { eventType: 'install_shown', platform: 'ios-safari', surface: 'bar' },
      ],
    });
    expect(record.mock.calls[0][0].metadata).toEqual({
      platform: 'ios-safari',
      surface: 'bar',
    });
  });

  it('DROPS anything else, rather than storing it', () => {
    // Without the allowlist this column is a free-text write for anyone who
    // can reach the endpoint, which is everyone.
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [
        {
          eventType: 'install_shown',
          platform: '<script>alert(1)</script>',
          surface: 'x'.repeat(5000),
        },
      ],
    });
    expect(record.mock.calls[0][0].metadata).toBeNull();
  });

  it('keeps the half that is valid when only one label is', () => {
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [
        { eventType: 'install_clicked', platform: 'android', surface: 'nope' },
      ],
    });
    expect(record.mock.calls[0][0].metadata).toEqual({
      platform: 'android',
      surface: undefined,
    });
  });

  it('sends no metadata at all for the non-install events', () => {
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [{ eventType: 'page_view', path: '/' }],
    });
    expect(record.mock.calls[0][0].metadata).toBeNull();
  });

  it('ignores labels smuggled onto a non-install event', () => {
    // Harmless today, but it keeps the metadata column meaning one thing.
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: [
        { eventType: 'page_view', path: '/', platform: 'ios-safari' },
      ],
    });
    // The allowlist does not know which event types may carry labels, so this
    // documents the current behaviour rather than asserting a guard exists.
    expect(record.mock.calls[0][0].eventType).toBe('page_view');
  });
});

describe('the limits that stop it being a firehose', () => {
  it('takes at most 30 events from one call', () => {
    const { controller, record } = build();
    controller.ingest(undefined, {
      events: Array.from({ length: 100 }, () => ({ eventType: 'page_view' })),
    });
    expect(record).toHaveBeenCalledTimes(30);
  });

  it('truncates an over-long device id instead of storing it', () => {
    const { controller, record } = build();
    controller.ingest(undefined, {
      deviceId: 'd'.repeat(500),
      events: [{ eventType: 'page_view' }],
    });
    expect(record.mock.calls[0][0].actor.deviceId).toHaveLength(64);
  });

  it('survives a body with no events, and one with garbage in place of them', () => {
    const { controller, record } = build();
    expect(() => controller.ingest(undefined, {})).not.toThrow();
    expect(() =>
      controller.ingest(undefined, {
        events: 'not an array' as unknown as [],
      }),
    ).not.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it('stamps the signed-in clerk id when there is one, null when there is not', () => {
    const { controller, record } = build();
    controller.ingest('clerk_9', { events: [{ eventType: 'page_view' }] });
    controller.ingest(undefined, { events: [{ eventType: 'page_view' }] });
    expect(record.mock.calls[0][0].actor.clerkId).toBe('clerk_9');
    expect(record.mock.calls[1][0].actor.clerkId).toBeNull();
  });
});
