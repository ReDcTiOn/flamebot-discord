"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Живое обновление страницы: раз в N секунд забирает свежие данные с сервера без
// перезагрузки — прокрутка, открытые вкладки и введённый текст остаются на месте.
// Пока вкладка браузера скрыта или открыто окно, обновление на паузе.
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [updatedAt, setUpdatedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const hidden = document.visibilityState !== "visible";
      const busy = !!document.querySelector("dialog[open]");
      setPaused(hidden || busy);
      if (hidden || busy) return;
      startTransition(() => {
        router.refresh();
      });
      setUpdatedAt(Date.now());
    };
    const t = setInterval(refresh, seconds * 1000);
    // Вернулись на вкладку — сразу обновляем, не ждём следующего такта.
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, seconds]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ago = Math.max(0, Math.round((now - updatedAt) / 1000));
  const label = pending ? "Обновляю…" : paused ? "Обновление на паузе" : ago < 2 ? "Обновлено только что" : `Обновлено ${ago} с назад`;

  return (
    <span className={paused ? "live-chip paused" : "live-chip"} title={`Данные обновляются сами каждые ${seconds} с`} aria-live="off">
      <span className="live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
