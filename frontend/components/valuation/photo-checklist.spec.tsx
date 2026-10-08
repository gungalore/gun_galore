// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhotoChecklist } from './photo-checklist';

describe('PhotoChecklist', () => {
  it('renders items in priority order and marks required ones', () => {
    render(
      <PhotoChecklist
        items={[
          { tag: 'CONDITION', label: 'Close-up of condition', priority: 3, required: false, hint: 'Wear' },
          { tag: 'WHOLE_ITEM', label: 'The whole item', priority: 1, required: true, hint: 'One clear shot' },
        ]}
      />,
    );

    const labels = screen.getAllByText(/whole item|close-up of condition/i).map((el) => el.textContent);
    expect(labels[0]).toBe('The whole item');
    expect(screen.getByText('required')).toBeInTheDocument();
  });

  it('renders nothing when the checklist is empty', () => {
    const { container } = render(<PhotoChecklist items={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
