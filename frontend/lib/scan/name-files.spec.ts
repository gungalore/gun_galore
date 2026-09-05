import { describe, expect, it } from 'vitest';
import { NAME_MAX, nameFiles, safeName } from './name-files';

const jpg = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/jpeg' });

describe('safeName', () => {
  it('strips what a filesystem refuses and collapses whitespace', () => {
    expect(safeName('  Licence:  Rifle / 2026?  ')).toBe('Licence Rifle 2026');
    expect(safeName('a<b>c|d"e*f')).toBe('a b c d e f');
  });

  it('never yields a hidden file or a trailing dot', () => {
    expect(safeName('...secret')).toBe('secret');
    expect(safeName('name...')).toBe('name');
  });

  it('returns empty for nothing usable, so the caller keeps its own name', () => {
    expect(safeName('   ')).toBe('');
    expect(safeName('///')).toBe('');
  });

  it('caps the length', () => {
    expect(safeName('x'.repeat(200)).length).toBe(NAME_MAX);
  });
});

describe('nameFiles', () => {
  it('⚠️ THE TYPED NAME REACHES THE FILE — one page takes it as given', () => {
    const [f] = nameFiles([jpg('scan-1725000000000.jpg')], 'Rifle licence');
    expect(f.name).toBe('Rifle licence.jpg');
    expect(f.type).toBe('image/jpeg');
  });

  it('numbers the pages of a multi-page document', () => {
    const out = nameFiles([jpg('a.jpg'), jpg('b.jpg'), jpg('c.jpg')], 'Motivation');
    expect(out.map((f) => f.name)).toEqual([
      'Motivation p1.jpg',
      'Motivation p2.jpg',
      'Motivation p3.jpg',
    ]);
  });

  it('keeps the original extension', () => {
    const [f] = nameFiles([new File([1 as unknown as BlobPart], 'x.PNG', { type: 'image/png' })], 'Card');
    expect(f.name).toBe('Card.png');
  });

  it('leaves files untouched when the name is empty or unusable', () => {
    const files = [jpg('scan-1.jpg'), jpg('scan-2.jpg')];
    expect(nameFiles(files, '   ')).toBe(files);
    expect(nameFiles(files, '?*|')).toBe(files);
  });

  it('keeps the bytes', async () => {
    const [f] = nameFiles([jpg('scan.jpg')], 'Card');
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
