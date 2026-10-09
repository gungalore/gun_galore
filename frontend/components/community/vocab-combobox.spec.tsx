// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VocabEntry } from '../../lib/post-vocab';
import { VocabCombobox } from './vocab-combobox';

const ENTRIES: VocabEntry[] = [
  { value: 'greater-kudu', label: 'Greater kudu', aliases: ['kudu', 'koedoe'] },
  { value: 'springbok', label: 'Springbok' },
  { value: 'warthog', label: 'Warthog', aliases: ['vlakvark'] },
];

describe('VocabCombobox', () => {
  it('shows nothing until the member types', async () => {
    render(
      <VocabCombobox
        ariaLabel="Species"
        entries={ENTRIES}
        value={undefined}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.type(screen.getByRole('combobox', { name: 'Species' }), 's');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('suggests and commits a clicked entry (single, slug)', async () => {
    const onChange = vi.fn();
    render(
      <VocabCombobox
        ariaLabel="Species"
        entries={ENTRIES}
        value={undefined}
        onChange={onChange}
      />,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'Species' }), 'spring');
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Springbok' }));
    expect(onChange).toHaveBeenCalledWith('springbok');
  });

  it('accepts free text on Enter (normalised slug)', async () => {
    const onChange = vi.fn();
    render(
      <VocabCombobox
        ariaLabel="Species"
        entries={ENTRIES}
        value={undefined}
        onChange={onChange}
      />,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'Species' }), 'Blue Duiker');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('blue-duiker');
  });

  it('keeps free text verbatim in label mode', async () => {
    const onChange = vi.fn();
    render(
      <VocabCombobox
        ariaLabel="Cartridge"
        entries={ENTRIES}
        value={undefined}
        onChange={onChange}
        storeMode="label"
      />,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'Cartridge' }), '6.5 Creedmoor');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('6.5 Creedmoor');
  });

  it('renders selected tokens and removes them', async () => {
    const onChange = vi.fn();
    render(
      <VocabCombobox
        ariaLabel="Species"
        entries={ENTRIES}
        value={['greater-kudu', 'warthog']}
        onChange={onChange}
        multiple
      />,
    );
    expect(screen.getByText('Greater kudu')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Remove Warthog' }));
    expect(onChange).toHaveBeenCalledWith(['greater-kudu']);
  });

  it('adds via keyboard: ArrowDown then Enter picks the suggestion', async () => {
    const onChange = vi.fn();
    render(
      <VocabCombobox
        ariaLabel="Species"
        entries={ENTRIES}
        value={[]}
        onChange={onChange}
        multiple
      />,
    );
    const input = screen.getByRole('combobox', { name: 'Species' });
    await userEvent.type(input, 'kudu');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith(['greater-kudu']);
  });
});
