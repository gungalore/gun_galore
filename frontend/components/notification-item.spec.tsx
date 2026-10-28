// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { NotificationItem } from './notification-item';
import type { NotificationItem as N } from '@/lib/notifications';

// The clear control used to be a bare faint "×" members could not find. It is
// now a labelled "Clear" pill; these tests pin that it exists on dismissible
// rows, fires onDismiss, and does NOT appear where it would be wrong.

function item(over: Partial<N> = {}): N {
  return {
    id: 'n1',
    category: 'ACCOUNT',
    type: 'post_liked',
    title: 'Someone liked your post',
    body: '@bob liked your post.',
    url: '/community/p/1',
    iconKey: null,
    linkedType: 'post',
    linkedId: '1',
    dismissible: true,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('NotificationItem — clear control', () => {
  it('renders an explicit, labelled Clear button on a dismissible row', () => {
    const { getByRole } = render(
      <NotificationItem item={item()} onDismiss={() => {}} />,
    );
    const btn = getByRole('button', { name: /clear this notification/i });
    expect(btn.textContent).toMatch(/clear/i);
  });

  it('calls onDismiss with the row id when Clear is tapped', () => {
    const onDismiss = vi.fn();
    const { getByRole } = render(
      <NotificationItem item={item()} onDismiss={onDismiss} />,
    );
    fireEvent.click(getByRole('button', { name: /clear this notification/i }));
    expect(onDismiss).toHaveBeenCalledWith('n1');
  });

  it('shows no Clear button on an action-required row (explicit CTA instead)', () => {
    const { queryByRole, getByText } = render(
      <NotificationItem
        item={item({ type: 'new_sale', dismissible: false })}
        onDismiss={() => {}}
      />,
    );
    expect(queryByRole('button', { name: /clear this notification/i })).toBeNull();
    expect(getByText('Accept sale')).toBeTruthy();
  });

  it('shows no Clear button once the row is resolved', () => {
    const { queryByRole } = render(
      <NotificationItem
        item={item({ resolvedAt: new Date().toISOString() })}
        onDismiss={() => {}}
      />,
    );
    expect(queryByRole('button', { name: /clear this notification/i })).toBeNull();
  });
});

describe('NotificationItem — acting on the row', () => {
  it('makes the CTA pill part of the link, not a dead span beside it', () => {
    const { getByText } = render(
      <NotificationItem
        item={item({ type: 'new_sale', dismissible: false })}
        onDismiss={() => {}}
      />,
    );
    expect(getByText('Accept sale').closest('a')?.getAttribute('href')).toBe(
      '/community/p/1',
    );
  });

  it('opens the credential a legacy reminder was raised for', () => {
    const { container } = render(
      <NotificationItem
        item={item({
          type: 'licence_centre_expiry_100',
          url: '/documents',
          linkedType: 'credential',
          linkedId: 'ccred123',
          dismissible: false,
        })}
        onDismiss={() => {}}
      />,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/documents?doc=ccred123',
    );
  });
});
