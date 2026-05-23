'use client';

// Categories tree editor — flat list grouped by parentId, indented to
// show hierarchy. Each row has inline controls: toggle active (eye
// icon), edit name + flags (opens modal), reorder (move up / down
// among siblings via PATCH sortOrder).
//
// Tree depth in the seed data is 2 (parents + sub-categories), so we
// render top-level parents with their children nested under them.
// Three-level deep trees would need recursion; left as future work.

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  isFirearm: boolean;
  requiresLicence: boolean;
  availableSecondhand: boolean;
  availableNewStore: boolean;
  isActive: boolean;
  sortOrder: number;
  _count: { listings: number };
}

function getToken() {
  return document.cookie.match(/gg_admin_sess=([^;]+)/)?.[1] ?? '';
}

export default function CategoriesTree({ initial }: { initial: Category[] }) {
  const router = useRouter();
  const [createParent, setCreateParent] = useState<string | null | undefined>(undefined);
  const [editing, setEditing] = useState<Category | null>(null);

  // Group: parents first (parentId === null), then children indexed by parentId.
  const parents = initial
    .filter((c) => c.parentId === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const childrenByParent = new Map<string, Category[]>();
  for (const c of initial) {
    if (c.parentId) {
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
  }

  async function toggleActive(c: Category) {
    const newActive = !c.isActive;
    const reason = window.prompt(
      `${newActive ? 'Reactivate' : 'Deactivate'} "${c.name}"? Briefly explain why for the audit log (≥3 chars):`,
    );
    if (!reason || reason.trim().length < 3) return;
    await fetch(`${API_URL}/admin/categories/${c.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken()}`,
      },
      body: JSON.stringify({ isActive: newActive, reason: reason.trim() }),
    });
    router.refresh();
  }

  return (
    <>
      <div className="mb-4">
        <button
          onClick={() => setCreateParent(null)}
          className="px-3 py-1.5 rounded text-sm font-medium"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          + Add top-level category
        </button>
      </div>

      <div
        className="rounded-[8px] overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
      >
        {parents.map((p) => {
          const kids = (childrenByParent.get(p.id) ?? []).sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
          );
          return (
            <div
              key={p.id}
              style={{ borderBottom: '0.5px solid var(--border)' }}
            >
              <CategoryRow
                category={p}
                depth={0}
                onToggle={() => toggleActive(p)}
                onEdit={() => setEditing(p)}
                onAddChild={() => setCreateParent(p.id)}
              />
              {kids.map((k) => (
                <CategoryRow
                  key={k.id}
                  category={k}
                  depth={1}
                  onToggle={() => toggleActive(k)}
                  onEdit={() => setEditing(k)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {createParent !== undefined && (
        <CategoryFormModal
          mode="create"
          parentId={createParent}
          onClose={() => setCreateParent(undefined)}
          onDone={() => {
            setCreateParent(undefined);
            router.refresh();
          }}
        />
      )}
      {editing && (
        <CategoryFormModal
          mode="edit"
          category={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function CategoryRow({
  category,
  depth,
  onToggle,
  onEdit,
  onAddChild,
}: {
  category: Category;
  depth: number;
  onToggle: () => void;
  onEdit: () => void;
  onAddChild?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-2 text-sm"
      style={{
        paddingLeft: 16 + depth * 24,
        background: depth === 0 ? 'var(--bg-inset)' : undefined,
        opacity: category.isActive ? 1 : 0.5,
      }}
    >
      <div className="flex-1 min-w-0">
        <p
          className="truncate"
          style={{ color: 'var(--text-primary)', fontWeight: depth === 0 ? 500 : 400 }}
        >
          {category.name}
          {category.isFirearm && (
            <span
              className="ml-2 text-xs"
              style={{ color: 'var(--red)' }}
            >
              🔒 firearm
            </span>
          )}
          {category.requiresLicence && (
            <span
              className="ml-1 text-xs"
              style={{ color: 'var(--red)' }}
            >
              · licence
            </span>
          )}
        </p>
        <p
          className="text-xs"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {category.slug} · {category._count.listings} listing{category._count.listings === 1 ? '' : 's'}
          {!category.availableSecondhand && ' · hidden from used marketplace'}
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {onAddChild && (
          <button
            onClick={onAddChild}
            className="text-xs px-2 py-1 rounded"
            style={{
              background: 'transparent',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            + child
          </button>
        )}
        <button
          onClick={onEdit}
          className="text-xs px-2 py-1 rounded"
          style={{
            background: 'transparent',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
        >
          Edit
        </button>
        <button
          onClick={onToggle}
          className="text-xs px-2 py-1 rounded"
          style={{
            background: 'transparent',
            border: `0.5px solid ${category.isActive ? 'var(--border)' : '#22c55e'}`,
            color: category.isActive ? 'var(--text-tertiary)' : '#22c55e',
            cursor: 'pointer',
          }}
          title={category.isActive ? 'Deactivate' : 'Reactivate'}
        >
          {category.isActive ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

function CategoryFormModal({
  mode,
  category,
  parentId,
  onClose,
  onDone,
}: {
  mode: 'create' | 'edit';
  category?: Category;
  parentId?: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: category?.name ?? '',
    isFirearm: category?.isFirearm ?? false,
    requiresLicence: category?.requiresLicence ?? false,
    availableSecondhand: category?.availableSecondhand ?? true,
    availableNewStore: category?.availableNewStore ?? false,
    sortOrder: category?.sortOrder ?? 0,
  });
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        ...form,
        name: form.name.trim(),
      };
      if (mode === 'create') {
        body.parentId = parentId ?? null;
      }
      if (mode === 'edit') {
        body.reason = reason.trim();
      }
      const url =
        mode === 'create'
          ? `${API_URL}/admin/categories`
          : `${API_URL}/admin/categories/${category!.id}`;
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? `Error ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          maxWidth: 480,
          width: '100%',
          padding: 24,
          borderRadius: 10,
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p
          className="text-base mb-4"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          {mode === 'create'
            ? parentId === null
              ? 'New top-level category'
              : 'New sub-category'
            : `Edit ${category?.name}`}
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
              Name
            </label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              style={inputStyle}
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
              Sort order (lower = earlier)
            </label>
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: parseInt(e.target.value, 10) || 0 }))}
              style={inputStyle}
            />
          </div>

          <Toggle
            label="Is firearm category"
            hint="Items here are firearms — affects FCA flags, dealer routing."
            checked={form.isFirearm}
            onChange={(v) => setForm((f) => ({ ...f, isFirearm: v }))}
          />
          <Toggle
            label="Requires licence (SAPS dealer transfer)"
            hint="Item must ship via licensed dealer (Firearms + barrels)."
            checked={form.requiresLicence}
            onChange={(v) => setForm((f) => ({ ...f, requiresLicence: v }))}
          />
          <Toggle
            label="Available on used marketplace"
            hint="Disable for live-ammo categories where private resale is banned."
            checked={form.availableSecondhand}
            onChange={(v) => setForm((f) => ({ ...f, availableSecondhand: v }))}
          />
          <Toggle
            label="Available on dealer new store"
            hint="Enable for categories sold via the M3 new-store phase."
            checked={form.availableNewStore}
            onChange={(v) => setForm((f) => ({ ...f, availableNewStore: v }))}
          />

          {mode === 'edit' && (
            <div>
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                Reason for change (≥3 chars, audit log)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                style={{ ...inputStyle, resize: 'vertical' }}
              />
            </div>
          )}

          {error && (
            <p className="text-xs" style={{ color: 'var(--red)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-2 rounded text-sm"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (mode === 'edit' && reason.trim().length < 3)}
              className="flex-1 py-2 rounded text-sm font-medium"
              style={{
                background: busy ? 'var(--bg-inset)' : 'var(--red)',
                color: busy ? 'var(--text-tertiary)' : '#fff',
                border: 'none',
                cursor: busy ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--red)', marginTop: 3 }}
      />
      <span>
        <span style={{ color: 'var(--text-primary)' }}>{label}</span>
        <span
          className="block text-xs"
          style={{ color: 'var(--text-tertiary)' }}
        >
          {hint}
        </span>
      </span>
    </label>
  );
}
