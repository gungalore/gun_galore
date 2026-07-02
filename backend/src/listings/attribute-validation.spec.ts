import { CategoryAttribute } from '@prisma/client';
import { validateAndCleanAttributes } from './attribute-validation';

/**
 * Pure-function unit tests for P4.2 attribute value validation. No DB — the
 * definitions are hand-built CategoryAttribute rows. Covers the four policy
 * branches the task calls out: required-missing, bad SELECT, number coercion,
 * and unknown-key-dropped.
 */
describe('validateAndCleanAttributes', () => {
  // Minimal factory — only the fields the validator reads matter.
  const def = (
    partial: Partial<CategoryAttribute> & Pick<CategoryAttribute, 'key' | 'label' | 'type'>,
  ): CategoryAttribute =>
    ({
      id: partial.key,
      categoryId: 'cat1',
      unit: null,
      options: [],
      required: false,
      filterable: true,
      sortOrder: 0,
      isActive: true,
      createdAt: new Date(),
      ...partial,
    }) as CategoryAttribute;

  it('errors when a required attribute is missing/empty', () => {
    const defs = [def({ key: 'capacity', label: 'Capacity', type: 'NUMBER', required: true })];
    const { cleaned, error } = validateAndCleanAttributes(defs, {});
    expect(error).toBe('Capacity is required.');
    expect(cleaned).toEqual({});
  });

  it('treats empty string as absent for a required attribute', () => {
    const defs = [def({ key: 'size', label: 'Size', type: 'TEXT', required: true })];
    const { error } = validateAndCleanAttributes(defs, { size: '   ' });
    expect(error).toBe('Size is required.');
  });

  it('rejects a SELECT value that is not one of the options', () => {
    const defs = [
      def({ key: 'chem', label: 'Chemistry', type: 'SELECT', options: ['LiFePO4', 'AGM'] }),
    ];
    const { error } = validateAndCleanAttributes(defs, { chem: 'NiCad' });
    expect(error).toBe('Chemistry must be one of: LiFePO4, AGM.');
  });

  it('accepts a valid SELECT value', () => {
    const defs = [
      def({ key: 'chem', label: 'Chemistry', type: 'SELECT', options: ['LiFePO4', 'AGM'] }),
    ];
    const { cleaned, error } = validateAndCleanAttributes(defs, { chem: 'AGM' });
    expect(error).toBeNull();
    expect(cleaned).toEqual({ chem: 'AGM' });
  });

  it('coerces a numeric string to a number', () => {
    const defs = [def({ key: 'ah', label: 'Amp hours', type: 'NUMBER' })];
    const { cleaned, error } = validateAndCleanAttributes(defs, { ah: '105' });
    expect(error).toBeNull();
    expect(cleaned).toEqual({ ah: 105 });
  });

  it('rejects a non-numeric NUMBER value', () => {
    const defs = [def({ key: 'ah', label: 'Amp hours', type: 'NUMBER' })];
    const { error } = validateAndCleanAttributes(defs, { ah: 'lots' });
    expect(error).toBe('Amp hours must be a number.');
  });

  it('drops unknown keys not present in the definitions', () => {
    const defs = [def({ key: 'ah', label: 'Amp hours', type: 'NUMBER' })];
    const { cleaned, error } = validateAndCleanAttributes(defs, {
      ah: 100,
      bogus: 'nope',
    });
    expect(error).toBeNull();
    expect(cleaned).toEqual({ ah: 100 });
    expect(cleaned).not.toHaveProperty('bogus');
  });

  it('coerces boolean strings and trims/caps TEXT', () => {
    const defs = [
      def({ key: 'waterproof', label: 'Waterproof', type: 'BOOLEAN' }),
      def({ key: 'notes', label: 'Notes', type: 'TEXT' }),
    ];
    const { cleaned, error } = validateAndCleanAttributes(defs, {
      waterproof: 'true',
      notes: `  ${'x'.repeat(500)}  `,
    });
    expect(error).toBeNull();
    expect(cleaned.waterproof).toBe(true);
    expect((cleaned.notes as string).length).toBe(200);
  });

  it('rejects a non-boolean BOOLEAN value', () => {
    const defs = [def({ key: 'waterproof', label: 'Waterproof', type: 'BOOLEAN' })];
    const { error } = validateAndCleanAttributes(defs, { waterproof: 'maybe' });
    expect(error).toBe('Waterproof must be true or false.');
  });

  it('omits optional absent attributes from the cleaned object', () => {
    const defs = [
      def({ key: 'ah', label: 'Amp hours', type: 'NUMBER', required: false }),
    ];
    const { cleaned, error } = validateAndCleanAttributes(defs, {});
    expect(error).toBeNull();
    expect(cleaned).toEqual({});
  });
});
