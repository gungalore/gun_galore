// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageProtection } from './image-protection';

// The deterrent is intentionally narrow: images lose the native save/drag
// gestures, ordinary page content keeps its context menu and selection.
describe('ImageProtection', () => {
  it('blocks the context menu, drag and selection on an image', () => {
    render(
      <>
        <ImageProtection />
        <img alt="" data-testid="protected" />
      </>,
    );
    const image = screen.getByTestId('protected');

    for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      image.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('leaves normal page content alone', () => {
    render(
      <>
        <ImageProtection />
        <p data-testid="text">Selectable copy</p>
      </>,
    );
    const text = screen.getByTestId('text');

    for (const type of ['contextmenu', 'dragstart', 'selectstart']) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      text.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('protects images inside a picture wrapper', () => {
    render(
      <>
        <ImageProtection />
        <picture data-testid="picture">
          <img alt="" />
        </picture>
      </>,
    );
    const picture = screen.getByTestId('picture');
    const event = new Event('contextmenu', { bubbles: true, cancelable: true });
    picture.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
