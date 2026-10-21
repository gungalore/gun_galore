// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoDropzone } from './photo-dropzone';

function photo(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('PhotoDropzone thumbnails', () => {
  beforeEach(() => {
    let next = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:photo-${next++}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  it('shows a preview for a file that replaced a blurred one', async () => {
    const original = photo('original.jpg');
    const redacted = photo('redacted.jpg');

    const { container, rerender } = render(
      <PhotoDropzone files={[original]} onChange={() => undefined} />,
    );

    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        'blob:photo-0',
      );
    });

    rerender(<PhotoDropzone files={[redacted]} onChange={() => undefined} />);

    await waitFor(() => {
      const imgs = container.querySelectorAll('img');
      expect(imgs).toHaveLength(1);
      expect(imgs[0]).toHaveAttribute('src', 'blob:photo-1');
    });
  });
});
