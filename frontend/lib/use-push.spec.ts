// @vitest-environment jsdom

import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePush } from './use-push';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(async () => 'token'),
}));

vi.mock('./auth', () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
  useUser: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock('./use-standalone', () => ({
  useStandalone: () => true,
}));

function Probe() {
  const push = usePush();
  return createElement(
    'span',
    { 'data-testid': 'state' },
    `${push.ready ? 'ready' : 'loading'}:${push.enabled ? 'on' : 'off'}`,
  );
}

function response(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

describe('usePush per-device state', () => {
  let getSubscription: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getSubscription = vi.fn();
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: class {},
    });
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: {
        permission: 'granted',
        requestPermission: vi.fn(async () => 'granted'),
      },
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        getRegistration: vi.fn(async () => ({
          pushManager: { getSubscription },
        })),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/push/vapid-public-key')) {
          return response({ publicKey: 'public-key', ready: true });
        }
        if (url.endsWith('/push/me')) {
          return response({ subscribed: true });
        }
        return response({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('is OFF when the account has a subscription but this device does not', async () => {
    getSubscription.mockResolvedValue(null);

    render(createElement(Probe));

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('ready:off'),
    );
  });

  it('is ON only when this device also holds a subscription', async () => {
    getSubscription.mockResolvedValue({ endpoint: 'https://push.example/1' });

    render(createElement(Probe));

    await waitFor(() =>
      expect(screen.getByTestId('state')).toHaveTextContent('ready:on'),
    );
  });
});
