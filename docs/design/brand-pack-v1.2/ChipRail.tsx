// components/ui/ChipRail.tsx
// Global horizontal chip/pill selector. Use for EVERY row of category, filter or tag pills on the site
// (community categories, marketplace categories, auction filters, search refinements, calibre pickers).
// Styles: chip-rail.css (import once in globals.css after tokens.css).
"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

export type Chip = { value: string; label: string; icon?: ReactNode; count?: number };

type Props = {
  items: Chip[];
  /** single-select: value string. multi-select: array of values */
  value: string | string[];
  onChange: (value: string | string[]) => void;
  multiple?: boolean;
  size?: "sm" | "md";
  label: string;            // accessible name, e.g. "Community categories"
  className?: string;
};

export function ChipRail({ items, value, onChange, multiple = false, size = "md", label, className }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: false, end: false });
  const reduce = useReducedMotion();
  const pillId = useId();
  const selected = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", measure); };
  }, [measure, items.length]);

  // keep the active chip visible (on mount and when selection changes)
  useEffect(() => {
    if (multiple) return;
    const el = scroller.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "center", behavior: reduce ? "auto" : "smooth" });
  }, [value, multiple, reduce]);

  const page = (dir: 1 | -1) => {
    const el = scroller.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduce ? "auto" : "smooth" });
  };

  const toggle = (v: string) => {
    if (!multiple) return onChange(v);
    const arr = Array.isArray(value) ? value : [];
    onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  // arrow-key roving focus
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
    const btns = Array.from(scroller.current?.querySelectorAll<HTMLButtonElement>("button.chip") ?? []);
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? btns.length - 1
      : Math.min(btns.length - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1)));
    btns[next]?.focus(); e.preventDefault();
  };

  return (
    <div className={`chip-rail chip-rail--${size} ${className ?? ""}`}
      data-fade-start={edge.start} data-fade-end={edge.end}>
      <button type="button" className="chip-rail__arrow chip-rail__arrow--start" aria-label="Scroll left"
        tabIndex={-1} hidden={!edge.start} onClick={() => page(-1)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" /></svg>
      </button>

      <div ref={scroller} className="chip-rail__scroller" role={multiple ? "group" : "radiogroup"}
        aria-label={label} onKeyDown={onKey}>
        {items.map((c) => {
          const on = selected(c.value);
          return (
            <button key={c.value} type="button" className="chip" data-active={on}
              role={multiple ? "checkbox" : "radio"} aria-checked={on}
              tabIndex={multiple || on || (!items.some((x) => selected(x.value)) && c === items[0]) ? 0 : -1}
              onClick={() => toggle(c.value)}>
              {on && !multiple && (
                <motion.span layoutId={pillId} className="chip__pill" aria-hidden="true"
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38 }} />
              )}
              {multiple && on && (
                <svg className="chip__check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
              )}
              {c.icon && <span className="chip__icon" aria-hidden="true">{c.icon}</span>}
              <span className="chip__label">{c.label}</span>
              {typeof c.count === "number" && <span className="chip__count">{c.count}</span>}
            </button>
          );
        })}
      </div>

      <button type="button" className="chip-rail__arrow chip-rail__arrow--end" aria-label="Scroll right"
        tabIndex={-1} hidden={!edge.end} onClick={() => page(1)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" /></svg>
      </button>
    </div>
  );
}
