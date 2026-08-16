'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { Category } from '@/lib/types';
import { Pill } from './pill';

// Pill-based category picker. Two-step:
//   1. Show all top-level categories as pills.
//   2. When the user clicks one, briefly flash it red (350ms) then swap to
//      that category's children + a "← change" breadcrumb. The selected leaf
//      is what we commit to.
//
// If a parent has no children, selecting the parent counts as the leaf —
// the picker stays on the parent row with that pill highlighted.

interface Props {
  categories: Category[]; // flat list (parents + children) from /categories
  value: string | null;   // selected leaf category id
  onChange: (categoryId: string) => void;
  // When true, only show categories where availableSecondhand is true.
  // Used by the Sell form to hide live-ammo categories that can't be
  // resold between private individuals. Default false (show everything).
  secondhandOnly?: boolean;
}

// How long the parent pill stays red before the children appear. Short
// enough to feel snappy, long enough that the user notices it was selected.
const FLASH_MS = 350;

export function CategoryPicker({
  categories,
  value,
  onChange,
  secondhandOnly = false,
}: Props) {
  const { parents, childrenByParent, byId } = useMemo(() => {
    // Optionally drop categories not available on the used marketplace.
    const filtered = secondhandOnly
      ? categories.filter((c) => c.availableSecondhand)
      : categories;
    const parents = filtered
      .filter((c) => c.parentId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const childrenByParent = new Map<string, Category[]>();
    for (const c of filtered) {
      if (c.parentId) {
        const arr = childrenByParent.get(c.parentId) ?? [];
        arr.push(c);
        childrenByParent.set(c.parentId, arr);
      }
    }
    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    const byId = new Map<string, Category>();
    // byId needs to include ALL categories so existing selections still
    // resolve when secondhandOnly is toggled.
    for (const c of categories) byId.set(c.id, c);
    return { parents, childrenByParent, byId };
  }, [categories, secondhandOnly]);

  const selectedNode = value ? byId.get(value) : null;
  const initialOpenParent = selectedNode
    ? selectedNode.parentId ?? selectedNode.id
    : null;
  const [openParentId, setOpenParentId] = useState<string | null>(initialOpenParent);

  // Transient "just clicked" state — shows the red flash on the parent
  // before we swap to the children. Cleared when openParentId changes.
  const [pendingParentId, setPendingParentId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (selectedNode) {
      setOpenParentId(selectedNode.parentId ?? selectedNode.id);
    }
  }, [selectedNode]);

  useEffect(() => {
    // Cleanup on unmount
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  function handleParentClick(parent: Category) {
    if (pendingParentId) return; // already flashing
    const kids = childrenByParent.get(parent.id) ?? [];
    if (kids.length === 0) {
      // Leaf — pick it directly (still flash for consistency)
      setPendingParentId(parent.id);
      flashTimerRef.current = setTimeout(() => {
        onChange(parent.id);
        setOpenParentId(parent.id);
        setPendingParentId(null);
      }, FLASH_MS);
      return;
    }
    // Parent has children — flash the parent pill red, then drill down.
    setPendingParentId(parent.id);
    flashTimerRef.current = setTimeout(() => {
      setOpenParentId(parent.id);
      setPendingParentId(null);
      // If the user previously selected a child of THIS parent, keep it.
      // Otherwise clear so the form prompts them to pick a leaf.
      //
      // `selectedNode` undefined means the current value doesn't resolve in
      // `byId` at all — a stale draft, or a category the caller wasn't served.
      // That is NOT "the seller picked something under a different parent", so
      // clearing it here was wrong: merely opening a parent to browse wiped
      // the selection (and, on the sell form, the attribute values keyed to
      // it), and the wipe was autosaved so a refresh couldn't recover it.
      // Leave an unresolvable value alone and let the owner of the value
      // decide what to do with it.
      if (selectedNode && selectedNode.parentId !== parent.id) {
        onChange('');
      }
    }, FLASH_MS);
  }

  function handleChildClick(child: Category) {
    onChange(child.id);
  }

  function handleBack() {
    setOpenParentId(null);
    onChange('');
  }

  const openParent = openParentId ? byId.get(openParentId) : null;
  const openChildren = openParent
    ? (childrenByParent.get(openParent.id) ?? [])
    : [];

  return (
    <div>
      {/* Parents row — visible when no drill-down active OR during the flash */}
      {!openParent && (
        <div className="flex flex-wrap gap-2">
          {parents.map((p) => (
            <Pill
              key={p.id}
              label={p.name}
              selected={pendingParentId === p.id}
              onClick={() => handleParentClick(p)}
            />
          ))}
        </div>
      )}

      {/* Drill-down — selected parent + children */}
      {openParent && (
        <div>
          {/* Parent breadcrumb */}
          <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <button
              type="button"
              onClick={handleBack}
              className="hover:opacity-80 transition-opacity"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              ← All categories
            </button>
            <span style={{ color: 'var(--text-tertiary)' }}>/</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              {openParent.name}
            </span>
          </div>

          {/* Children pills */}
          {openChildren.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {openChildren.map((c) => (
                <Pill
                  key={c.id}
                  label={c.name}
                  selected={selectedNode?.id === c.id}
                  onClick={() => handleChildClick(c)}
                />
              ))}
            </div>
          ) : (
            // No sub-categories — render the parent itself as the only leaf
            <div className="flex flex-wrap gap-2">
              <Pill
                label={openParent.name}
                selected={selectedNode?.id === openParent.id}
                onClick={() => handleChildClick(openParent)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
