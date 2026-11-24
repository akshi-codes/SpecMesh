import { useEffect, useState } from "react";

export function useStoredState(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored == null ? fallback : JSON.parse(stored);
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* Preferences still work for this session when browser storage is unavailable. */
    }
  }, [key, value]);

  return [value, setValue];
}
