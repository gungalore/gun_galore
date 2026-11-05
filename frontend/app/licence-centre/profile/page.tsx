'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  motivationsApi,
  type MotivationField,
} from '@/lib/motivations-api';

const PROFILE_SECTION_ORDER = [
  'About you',
  'Your premises',
  'Firearms you already own',
  'Dedicated status',
  'Experience',
  'The firearm',
  'The SAPS 271 form',
  'History',
];

function Input({
  field,
  value,
  onChange,
}: {
  field: MotivationField;
  value: string;
  onChange: (value: string) => void;
}) {
  const choices =
    field.kind === 'yesno'
      ? ['Yes', 'No']
      : field.kind === 'choice'
        ? (field.choices ?? [])
        : (field.optionGroups ?? []).flatMap((group) =>
            group.options.map((option) => option.value),
          );

  if (choices.length) {
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-3 py-2 text-[13.5px]"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
        }}
      >
        <option value="">Not answered</option>
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type={field.kind === 'date' ? 'date' : 'text'}
      value={value}
      maxLength={field.maxLength}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border px-3 py-2 text-[13.5px]"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--bg-card)',
        color: 'var(--text-primary)',
      }}
    />
  );
}

export default function LicenceProfilePage() {
  const { getToken } = useAuth();
  const [fields, setFields] = useState<MotivationField[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await motivationsApi.profile(getToken);
      setFields(profile.fields);
      setAnswers(profile.answers);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const bySection = new Map<string, MotivationField[]>();
    for (const field of fields) {
      const list = bySection.get(field.section) ?? [];
      list.push(field);
      bySection.set(field.section, list);
    }
    return [...bySection.entries()].sort((a, b) => {
      const ai = PROFILE_SECTION_ORDER.indexOf(a[0]);
      const bi = PROFILE_SECTION_ORDER.indexOf(b[0]);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
  }, [fields]);

  const filled = Object.values(answers).filter((v) => v.trim()).length;

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await motivationsApi.saveProfile(getToken, answers);
      setAnswers(next.answers);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-5">
      <p className="text-[12px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        Licence Centre
      </p>
      <h1 className="mt-1 font-[family-name:var(--font-head)] text-[24px] font-medium tracking-[-0.01em] text-[var(--text-primary)]">
        Your licence profile
      </h1>
      <p className="mt-2 max-w-[62ch] text-[13.5px] leading-6 text-[var(--text-secondary)]">
        These are the facts that stay the same between applications — your
        details, your safe, your premises and your association. Change one here
        and every future motivation starts with it already filled in.
      </p>
      <p className="mt-1 text-[12.5px] text-[var(--text-tertiary)]">
        {filled} detail{filled === 1 ? '' : 's'} remembered
      </p>

      {loading ? (
        <p className="mt-5 text-[13.5px] text-[var(--text-tertiary)]">
          Loading…
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-[13px] text-[var(--red)]">{error}</p>
      ) : null}

      {!loading
        ? groups.map(([section, list]) => (
            <section key={section} className="mt-6">
              <h2 className="m-0 text-[14px] font-medium text-[var(--text-primary)]">
                {section}
              </h2>
              <div className="mt-2 grid gap-3">
                {list.map((field) => (
                  <label key={field.key} className="block">
                    <span className="mb-1 block text-[12.5px] text-[var(--text-secondary)]">
                      {field.label}
                    </span>
                    <Input
                      field={field}
                      value={answers[field.key] ?? ''}
                      onChange={(value) => {
                        setSaved(false);
                        setAnswers((prev) => ({ ...prev, [field.key]: value }));
                      }}
                    />
                    {field.help ? (
                      <span className="mt-1 block text-[11.5px] leading-4 text-[var(--text-tertiary)]">
                        {field.help}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </section>
          ))
        : null}

      <div className="sticky bottom-4 mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving || loading}
          className="rounded-lg px-4 py-2.5 text-[13.5px] font-medium text-white disabled:opacity-60"
          style={{ background: 'var(--red)' }}
        >
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {saved ? (
          <span className="text-[12.5px]" style={{ color: 'var(--text-secondary)' }}>
            Saved. Future applications will use these details.
          </span>
        ) : null}
        <a
          href="/licence-centre/applications"
          className="ml-auto text-[12.5px] text-[var(--text-secondary)]"
        >
          Back to applications
        </a>
      </div>
    </main>
  );
}
