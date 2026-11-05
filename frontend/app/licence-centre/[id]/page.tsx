'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '../../../lib/auth';
import { motivationsApi } from '@/lib/motivations-api';
import type {
  SheetItem,
  SheetResponse,
} from '@/components/licence-centre/contract';

const CONTROL =
  'mt-1 block w-full rounded-lg border bg-transparent px-2.5 py-2 text-[13.5px]';
const CONTROL_STYLE = {
  borderColor: 'var(--border)',
  color: 'var(--text-primary)',
} as const;

function optionsFor(item: SheetItem): string[] {
  if (item.choices?.length) return item.choices;
  if (item.optionGroups?.length) {
    return item.optionGroups.flatMap((group) =>
      group.options.map((option) => option.value),
    );
  }
  return (item.options ?? []).map((option) => option.key);
}

function isMissing(item: SheetItem, missingKeys: Set<string>): boolean {
  if (item.state === 'na' || !item.required) return false;
  if (item.state === 'needs_you' || item.state === 'suggested') return true;
  return missingKeys.has(item.key) && !item.value;
}

export default function EditMissingSheet() {
  const { getToken } = useAuth();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id ?? '';

  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await motivationsApi.sheet(getToken, id);
      setSheet(next);
      setValues(
        Object.fromEntries(next.items.map((item) => [item.key, item.value])),
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [getToken, id]);

  useEffect(() => {
    if (id) void load();
  }, [id, load]);

  const missingKeys = useMemo(() => {
    const keys = new Set<string>(sheet?.missing ?? []);
    for (const section of sheet?.sections ?? []) {
      for (const key of section.missing) keys.add(key);
    }
    return keys;
  }, [sheet]);

  const groups = useMemo(() => {
    if (!sheet) return [];
    const bySection = new Map<string, SheetItem[]>();
    for (const item of sheet.items) {
      if (!isMissing(item, missingKeys)) continue;
      const list = bySection.get(item.section) ?? [];
      list.push(item);
      bySection.set(item.section, list);
    }
    return [...bySection.entries()];
  }, [sheet, missingKeys]);

  const missingDocuments = useMemo(
    () =>
      (sheet?.needs.needs ?? []).filter(
        (need) => need.tier === 'required' && !need.have,
      ),
    [sheet],
  );

  async function save() {
    if (!sheet) return;
    const keys = [
      ...new Set(groups.flatMap(([, items]) => items.map((item) => item.key))),
    ];
    const changed = Object.fromEntries(
      keys
        .map((key) => [key, values[key] ?? ''])
        .filter(([, value]) => value.trim().length > 0),
    );
    if (!Object.keys(changed).length) {
      router.push(`/licence-centre/${id}/pack`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.saveAnswers(getToken, id, changed);
      router.push(`/licence-centre/${id}/pack`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!sheet) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 text-[13.5px] text-[var(--text-tertiary)]">
        {error ?? 'Loading what is missing…'}
      </main>
    );
  }

  const nothingMissing = groups.length === 0 && missingDocuments.length === 0;

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-12 pt-5">
      <Link
        href="/licence-centre/applications"
        className="mb-3 inline-flex min-h-[36px] items-center gap-1.5 text-[13px] font-medium text-[var(--text-secondary)] no-underline"
      >
        <span aria-hidden="true">&#8592;</span> Back to your applications
      </Link>

      <h1 className="m-0 font-[family-name:var(--font-head)] text-[24px] font-medium leading-[1.15] tracking-[-0.01em] text-[var(--text-primary)]">
        Finish what is missing
      </h1>
      <p className="m-0 mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
        {sheet.application.title ?? sheet.application.licenceTypeLabel} ·{' '}
        {sheet.application.referenceNumber}
      </p>

      {nothingMissing ? (
        <section
          className="mt-6 rounded-[var(--r-lg)] border px-5 py-6"
          style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
        >
          <p className="m-0 text-[14px] text-[var(--text-primary)]">
            Nothing is missing. Your motivation is ready to write.
          </p>
          <Link
            href={`/licence-centre/${id}/pack`}
            className="mt-4 inline-flex rounded-lg px-4 py-2.5 text-[13.5px] font-medium text-white"
            style={{ background: 'var(--red)' }}
          >
            Go to your pack
          </Link>
        </section>
      ) : (
        <>
          {groups.map(([section, items]) => (
            <section key={section} className="mt-6">
              <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[17px] font-medium text-[var(--text-primary)]">
                {section}
              </h2>
              <div className="grid gap-3">
                {items.map((item) => {
                  const options = optionsFor(item);
                  return (
                    <label
                      key={item.key}
                      className="block text-[12px] font-medium text-[var(--text-secondary)]"
                    >
                      {item.label}
                      {item.kind === 'long' ? (
                        <textarea
                          value={values[item.key] ?? ''}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [item.key]: e.target.value,
                            }))
                          }
                          rows={4}
                          className={CONTROL}
                          style={CONTROL_STYLE}
                        />
                      ) : options.length ? (
                        <select
                          value={values[item.key] ?? ''}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [item.key]: e.target.value,
                            }))
                          }
                          className={CONTROL}
                          style={CONTROL_STYLE}
                        >
                          <option value="">Choose…</option>
                          {options.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={item.kind === 'date' ? 'date' : 'text'}
                          value={values[item.key] ?? ''}
                          onChange={(e) =>
                            setValues((prev) => ({
                              ...prev,
                              [item.key]: e.target.value,
                            }))
                          }
                          className={CONTROL}
                          style={CONTROL_STYLE}
                        />
                      )}
                      {item.help ? (
                        <span className="mt-1 block text-[11.5px] font-normal leading-4 text-[var(--text-tertiary)]">
                          {item.help}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </section>
          ))}

          {missingDocuments.length ? (
            <section className="mt-6">
              <h2 className="m-0 mb-2 font-[family-name:var(--font-head)] text-[17px] font-medium text-[var(--text-primary)]">
                Documents still needed
              </h2>
              <ul className="m-0 grid gap-1.5 pl-5 text-[13px] text-[var(--text-secondary)]">
                {missingDocuments.map((need) => (
                  <li key={need.kind}>{need.label}</li>
                ))}
              </ul>
              <Link
                href={`/licence-centre/${id}/interview`}
                className="mt-3 inline-flex rounded-lg border px-3 py-2 text-[12.5px] font-medium text-[var(--text-primary)]"
                style={{ borderColor: 'var(--border)' }}
              >
                Upload these in the interview
              </Link>
            </section>
          ) : null}

          {error ? (
            <p className="mt-4 text-[12.5px] text-[var(--red)]">{error}</p>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="mt-6 w-full rounded-[var(--r-sm)] px-4 py-3 text-[14px] font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--red)' }}
          >
            {busy ? 'Saving…' : 'Save and go to my pack'}
          </button>
        </>
      )}
    </main>
  );
}
