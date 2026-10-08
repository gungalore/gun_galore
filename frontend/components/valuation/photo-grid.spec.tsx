// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PhotoGrid } from './photo-grid';
import type { ValuationImageView } from '../../lib/valuation-api';

const images: ValuationImageView[] = [
  { id: 'a', url: 'https://x/a.jpg', viewTag: null, source: 'DESKTOP' },
  { id: 'b', url: 'https://x/b.jpg', viewTag: 'LABEL_OR_STAMP', source: 'PHONE' },
];

describe('PhotoGrid', () => {
  it('renders one slot per photo allowance and empty slots numbered', () => {
    render(<PhotoGrid images={images} maxPhotos={8} onDelete={() => {}} />);

    expect(screen.getByAltText('Item photo 1')).toBeInTheDocument();
    // 6 empty slots (8 max, 2 filled)
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('calls onDelete with the photo id when the X is pressed', () => {
    const onDelete = vi.fn();
    render(<PhotoGrid images={images} maxPhotos={8} onDelete={onDelete} />);

    fireEvent.click(screen.getByLabelText('Remove photo 1'));
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('shows the view tag when one is set', () => {
    render(<PhotoGrid images={images} maxPhotos={8} onDelete={() => {}} />);
    expect(screen.getByText('label or stamp')).toBeInTheDocument();
  });
});
