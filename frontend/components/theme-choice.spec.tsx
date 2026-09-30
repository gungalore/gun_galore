// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ThemeChoice } from './theme-choice';
import { STORAGE_KEY } from '@/lib/use-theme';

// jsdom has no matchMedia, and the hook reads it whenever the preference
// resolves to 'system' — which is the default this control has to survive.
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      media: '(prefers-color-scheme: dark)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  );
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('ThemeChoice — the phone/PWA appearance control', () => {
  it('offers System, Light and Dark, with System selected by default', () => {
    render(<ThemeChoice />);
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['System', 'Light', 'Dark']);
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('writes the preference and flips the document theme when Dark is picked', async () => {
    render(<ThemeChoice />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');
    await waitFor(() =>
      expect(document.documentElement.dataset.theme).toBe('dark'),
    );
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('reads the STORED preference rather than guessing from the resolved theme', async () => {
    // The pre-paint script can render dark with nothing stored (OS dark), so
    // the resolved theme is not the preference. A stored 'light' must show on
    // the control after mount.
    window.localStorage.setItem(STORAGE_KEY, 'light');
    render(<ThemeChoice />);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Light' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
    expect(screen.getByRole('radio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
