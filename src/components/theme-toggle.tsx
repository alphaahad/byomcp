"use client";

import { useSyncExternalStore } from "react";
import { THEME_KEY } from "@/lib/theme";

export type ThemePref = "light" | "dark" | "system";
const KEY = THEME_KEY;
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === "system") delete el.dataset.theme;
  else el.dataset.theme = pref;
}


const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Auto" },
];

/** Light / Dark / Auto (follows the device). Remembered in this browser. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const pref = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    read,
    () => "system" as ThemePref,
  );

  const choose = (next: ThemePref) => {
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: still switch for this page */
    }
    apply(next);
    listeners.forEach((fn) => fn());
  };

  return (
    <div role="radiogroup" aria-label="Appearance" className={`flex rounded-[var(--radius-sm)] bg-[var(--fill)] p-0.5 text-xs ${className}`}>
      {OPTIONS.map((o) => {
        const on = pref === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(o.value)}
            title={o.value === "system" ? "Follow this device's setting" : `Always ${o.label.toLowerCase()}`}
            className={`flex-1 rounded-[6px] px-2 py-1 font-medium ${on ? "bg-[var(--surface)] text-ink shadow-[var(--shadow)]" : "text-ink-soft hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
