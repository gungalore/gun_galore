import { Province } from '@prisma/client';
import {
  normaliseProvince,
  normaliseLicence,
  canonicaliseLicence,
  extractDealerFromVerification,
  normaliseRegistrationNumber,
  findRegistrationNumber,
  registrationNumbersMatch,
} from './dealer-registry.util';

describe('canonicaliseLicence', () => {
  it('upper-cases and strips ALL whitespace so both write paths agree on the key', () => {
    // The manual admin path and the auto path must resolve the same physical
    // licence to one string, no matter the internal spacing.
    expect(canonicaliseLicence('gd 1234 5678')).toBe('GD12345678');
    expect(canonicaliseLicence('GD12345678')).toBe('GD12345678');
    expect(canonicaliseLicence('  Gd12345678  ')).toBe('GD12345678');
    expect(canonicaliseLicence('')).toBe('');
    expect(canonicaliseLicence(null)).toBe('');
  });
});

describe('normaliseProvince', () => {
  it('maps full names regardless of case / punctuation', () => {
    expect(normaliseProvince('Gauteng')).toBe(Province.GAUTENG);
    expect(normaliseProvince('western cape')).toBe(Province.WESTERN_CAPE);
    expect(normaliseProvince('Western Cape.')).toBe(Province.WESTERN_CAPE);
    expect(normaliseProvince('kwazulu-natal')).toBe(Province.KWAZULU_NATAL);
    expect(normaliseProvince('KwaZulu Natal')).toBe(Province.KWAZULU_NATAL);
    expect(normaliseProvince('North West')).toBe(Province.NORTH_WEST);
  });

  it('maps common abbreviations', () => {
    expect(normaliseProvince('GP')).toBe(Province.GAUTENG);
    expect(normaliseProvince('kzn')).toBe(Province.KWAZULU_NATAL);
    expect(normaliseProvince('WC')).toBe(Province.WESTERN_CAPE);
  });

  it('returns null for unknown / empty / null', () => {
    expect(normaliseProvince('Atlantis')).toBeNull();
    expect(normaliseProvince('')).toBeNull();
    expect(normaliseProvince('   ')).toBeNull();
    expect(normaliseProvince(null)).toBeNull();
    expect(normaliseProvince(undefined)).toBeNull();
  });
});

describe('normaliseLicence', () => {
  it('trims, upper-cases and strips whitespace', () => {
    expect(normaliseLicence('  gp 123 456 ')).toBe('GP123456');
    expect(normaliseLicence('1234567')).toBe('1234567');
  });

  it('rejects too-short and placeholder reads (never a bogus key)', () => {
    expect(normaliseLicence('abc')).toBeNull(); // < 4 chars
    expect(normaliseLicence('N/A')).toBeNull();
    expect(normaliseLicence('none')).toBeNull();
    expect(normaliseLicence('UNKNOWN')).toBeNull();
    expect(normaliseLicence('----')).toBeNull();
    expect(normaliseLicence('')).toBeNull();
    expect(normaliseLicence(null)).toBeNull();
    expect(normaliseLicence(undefined)).toBeNull();
  });
});

describe('extractDealerFromVerification', () => {
  it('prefers OCR name + normalises licence/province, keeps raw OCR address', () => {
    const out = extractDealerFromVerification({
      ocr: {
        extracted_dealer_licence: ' gp 55 66 77 ',
        extracted_dealer_name: 'Bushveld Firearms CC',
        extracted_dealer_address: '12 Kudu Rd, Unit 4',
        extracted_dealer_city: 'Polokwane',
        extracted_dealer_province: 'Limpopo',
      },
      stockedAtName: 'Bushveld (typed)',
      stockedAtAddress: '12 Kudu Road, Unit 4, Polokwane',
      stockedAtPhone: '+27 82 000 0000',
    });
    expect(out.licenceNumber).toBe('GP556677');
    expect(out.name).toBe('Bushveld Firearms CC'); // OCR name preferred
    expect(out.province).toBe(Province.LIMPOPO);
    expect(out.city).toBe('Polokwane');
    // Structured address prefers the human-typed value; OCR kept as rawAddress.
    expect(out.address).toBe('12 Kudu Road, Unit 4, Polokwane');
    expect(out.rawAddress).toBe('12 Kudu Rd, Unit 4');
    expect(out.phone).toBe('+27 82 000 0000');
  });

  it('falls back to the seller-typed name when OCR name is absent', () => {
    const out = extractDealerFromVerification({
      ocr: { extracted_dealer_licence: '9988776' },
      stockedAtName: 'Karoo Guns',
      stockedAtAddress: 'Main St',
      stockedAtPhone: null,
    });
    expect(out.name).toBe('Karoo Guns');
    expect(out.licenceNumber).toBe('9988776');
    expect(out.city).toBeNull();
    expect(out.province).toBeNull();
    expect(out.rawAddress).toBeNull();
    expect(out.phone).toBeNull();
  });

  it('returns a null licence (skip signal) + safe name when nothing is readable', () => {
    const out = extractDealerFromVerification({
      ocr: null,
      stockedAtName: null,
      stockedAtAddress: null,
      stockedAtPhone: null,
    });
    expect(out.licenceNumber).toBeNull();
    expect(out.name).toBe('Unnamed dealer');
    expect(out.address).toBe('');
  });
});

describe('normaliseRegistrationNumber', () => {
  it('canonicalises every way a CIPC number is printed', () => {
    expect(normaliseRegistrationNumber('2019/139703/07')).toBe('2019/139703/07');
    expect(normaliseRegistrationNumber('2019-139703-07')).toBe('2019/139703/07');
    expect(normaliseRegistrationNumber('2019 139703 07')).toBe('2019/139703/07');
    expect(normaliseRegistrationNumber('201913970307')).toBe('2019/139703/07');
    expect(normaliseRegistrationNumber('CK 2019/139703/07')).toBe('2019/139703/07');
    expect(normaliseRegistrationNumber('Reg No: 2019/139703/07')).toBe('2019/139703/07');
  });

  it('rejects anything that is not a registration number', () => {
    expect(normaliseRegistrationNumber('')).toBeNull();
    expect(normaliseRegistrationNumber(null)).toBeNull();
    expect(normaliseRegistrationNumber('061 583 0442')).toBeNull();
    expect(normaliseRegistrationNumber('101091')).toBeNull();
    expect(normaliseRegistrationNumber('1899/123456/07')).toBeNull();
  });
});

describe('findRegistrationNumber', () => {
  it('finds the number inside a page of stamp text', () => {
    const text = [
      'BOOMSTICKS CAPE TOWN (PTY) LTD',
      'Reg No: 2019/139703/07',
      '73 HARRINGTON STR, CAPE TOWN, 8001',
      'Contact: 061 583 0442 / 021 0200620',
      'Dealer Licence: 101091',
    ].join('\n');
    expect(findRegistrationNumber(text)).toBe('2019/139703/07');
  });

  it('does not mistake a phone number or a licence number for it', () => {
    expect(findRegistrationNumber('Contact: 061 583 0442')).toBeNull();
    expect(findRegistrationNumber('Dealer Licence: 101091')).toBeNull();
  });
});

describe('registrationNumbersMatch', () => {
  it('matches across separators but not across businesses', () => {
    expect(registrationNumbersMatch('2019/139703/07', '201913970307')).toBe(true);
    expect(registrationNumbersMatch('2019/139703/07', '2019/139704/07')).toBe(false);
    expect(registrationNumbersMatch(null, '2019/139703/07')).toBe(false);
  });
});
