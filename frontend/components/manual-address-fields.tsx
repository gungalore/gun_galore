'use client';

import React from 'react';
import type { Province } from '@/lib/types';
import { PROVINCE_LABELS } from '@/lib/utils';

// Compact pickup-address block. Shown beneath AddressAutocomplete so the
// seller can verify what Google parsed AND tweak anything wrong (estates,
// complexes, unit numbers etc. that Places often misses or mis-locates).
//
// Ported from old project (frontend/src/components/ui/ManualAddressFields.tsx)
// — modernised to use our design tokens + Province enum.

export interface ManualAddressValue {
  building: string;
  street: string;
  address2: string;
  suburb: string;
  city: string;
  postalCode: string;
  province: Province | '';
}

export const emptyManualAddress: ManualAddressValue = {
  building: '',
  street: '',
  address2: '',
  suburb: '',
  city: '',
  postalCode: '',
  province: '',
};

interface Props {
  value: ManualAddressValue;
  onChange: (next: ManualAddressValue) => void;
  /** Optional id prefix so multiple instances on one page don't collide. */
  idPrefix?: string;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
};

// The old project's manual address fields had NO autocomplete or opt-out
// attributes — and worked cleanly. Adding autoComplete on every input
// makes Chrome offer its saved-address dropdown, which can overlay
// icons inside the field. Keep these as bare-bones inputs.

export function ManualAddressFields({ value, onChange, idPrefix }: Props) {
  const set =
    (k: keyof ManualAddressValue) =>
    (v: string) =>
      onChange({ ...value, [k]: v as ManualAddressValue[typeof k] });
  const p = idPrefix ? `${idPrefix}-` : '';

  return (
    <div className="space-y-2.5">
      <input
        id={`${p}addr-building`}
        style={inputStyle}
        type="text"
        placeholder="Unit / Complex / Building (optional)"
        value={value.building}
        onChange={(e) => set('building')(e.target.value)}
      />
      <input
        id={`${p}addr-street`}
        style={inputStyle}
        type="text"
        placeholder="Street address *"
        value={value.street}
        onChange={(e) => set('street')(e.target.value)}
      />
      <input
        id={`${p}addr-line2`}
        style={inputStyle}
        type="text"
        placeholder="Address line 2 (optional)"
        value={value.address2}
        onChange={(e) => set('address2')(e.target.value)}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          id={`${p}addr-suburb`}
          style={inputStyle}
          type="text"
          placeholder="Suburb *"
          value={value.suburb}
          onChange={(e) => set('suburb')(e.target.value)}
        />
        <input
          id={`${p}addr-city`}
          style={inputStyle}
          type="text"
          placeholder="City / Town *"
          value={value.city}
          onChange={(e) => set('city')(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <input
          id={`${p}addr-postal`}
          style={inputStyle}
          type="text"
          placeholder="Postal code *"
          value={value.postalCode}
          onChange={(e) => set('postalCode')(e.target.value)}
        />
        <select
          id={`${p}addr-province`}
          style={{ ...inputStyle, appearance: 'none', cursor: 'pointer' }}
          value={value.province}
          onChange={(e) =>
            set('province')(e.target.value as ManualAddressValue['province'])
          }
        >
          <option value="">Province *</option>
          {(
            Object.entries(PROVINCE_LABELS) as [Province, string][]
          ).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Build a comma-joined address string from the fields. */
export function formatManualAddress(v: ManualAddressValue): string {
  return [
    v.building,
    v.street,
    v.address2,
    v.suburb,
    v.city,
    v.province ? PROVINCE_LABELS[v.province] : '',
    v.postalCode,
  ]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(', ');
}
