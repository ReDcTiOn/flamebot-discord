"use client";

import { useCallback, useRef, useState } from "react";

const LIMIT = 100;
// Подряд идущие правки одного поля (набор текста, ползунок) сливаются в один шаг.
const MERGE_MS = 800;

export function useHistory<T>(initial: T) {
  const [value, setValue] = useState(initial);
  const ref = useRef({ value: initial, past: [] as T[], future: [] as T[], lastKey: "", lastAt: 0 });
  const [, bump] = useState(0);

  const set = useCallback((next: T | ((v: T) => T), key?: string) => {
    const h = ref.current;
    const v = typeof next === "function" ? (next as (v: T) => T)(h.value) : next;
    if (v === h.value) return;
    const now = Date.now();
    const merge = key !== undefined && key === h.lastKey && now - h.lastAt < MERGE_MS;
    if (!merge) {
      h.past.push(h.value);
      if (h.past.length > LIMIT) h.past.shift();
    }
    h.future = [];
    h.lastKey = key ?? "";
    h.lastAt = now;
    h.value = v;
    setValue(v);
    bump((n) => n + 1);
  }, []);

  // Без записи в историю: промежуточные кадры перетаскивания.
  const setSilently = useCallback((next: (v: T) => T) => {
    const h = ref.current;
    h.value = next(h.value);
    setValue(h.value);
  }, []);

  // Точка отката перед перетаскиванием.
  const checkpoint = useCallback(() => {
    const h = ref.current;
    h.past.push(h.value);
    if (h.past.length > LIMIT) h.past.shift();
    h.future = [];
    h.lastKey = "";
    bump((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const h = ref.current;
    const prev = h.past.pop();
    if (prev === undefined) return false;
    h.future.push(h.value);
    h.value = prev;
    h.lastKey = "";
    setValue(prev);
    bump((n) => n + 1);
    return true;
  }, []);

  const redo = useCallback(() => {
    const h = ref.current;
    const next = h.future.pop();
    if (next === undefined) return false;
    h.past.push(h.value);
    h.value = next;
    h.lastKey = "";
    setValue(next);
    bump((n) => n + 1);
    return true;
  }, []);

  // Если перетаскивание ничего не изменило, лишний шаг убираем.
  const dropCheckpointIfSame = useCallback(() => {
    const h = ref.current;
    if (h.past.at(-1) !== undefined && JSON.stringify(h.past.at(-1)) === JSON.stringify(h.value)) {
      h.past.pop();
      bump((n) => n + 1);
    }
  }, []);

  return {
    value,
    set,
    setSilently,
    checkpoint,
    dropCheckpointIfSame,
    undo,
    redo,
    canUndo: ref.current.past.length > 0,
    canRedo: ref.current.future.length > 0,
  };
}
