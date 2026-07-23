"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./dashboard.module.css";

export interface MoreMenuItem {
  key: string;
  label: string;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  items: MoreMenuItem[];
  busy?: boolean;
  align?: "left" | "right";
  triggerLabel?: string;
}

// Accessible overflow menu for secondary row/drawer actions. Closes on outside
// click and Escape; items are real buttons/links so they are keyboard reachable.
export default function MoreMenu({ items, busy, align = "right", triggerLabel = "More" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div className={styles.moreRoot} ref={rootRef}>
      <button
        type="button"
        className={`${styles.btn} ${styles.btnMore}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={triggerLabel}
        disabled={busy}
        onClick={() => setOpen(o => !o)}
      >
        ⋯ {triggerLabel}
      </button>
      {open && (
        <div
          className={`${styles.moreMenu} ${align === "left" ? styles.moreMenuLeft : ""}`}
          role="menu"
        >
          {items.map(it =>
            it.href ? (
              <a
                key={it.key}
                role="menuitem"
                href={it.href}
                className={styles.moreMenuItem}
                onClick={() => setOpen(false)}
              >
                {it.label}
              </a>
            ) : (
              <button
                key={it.key}
                type="button"
                role="menuitem"
                className={`${styles.moreMenuItem} ${it.danger ? styles.moreMenuItemDanger : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                {it.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
