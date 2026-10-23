"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

// Живое обновление страницы: раз в N секунд забирает свежие данные с сервера без
// перезагрузки — прокрутка, открытые вкладки и введённый текст остаются на месте.
// Пока вкладка браузера скрыта или открыто окно, обновление на паузе.
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Номер такта: меняется при каждом обновлении и перезапускает заполнение кольца.
  const [cycle, setCycle] = useState(0);
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
      setCycle((n) => n + 1);
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

  const label = pending ? "Обновляю данные…" : paused ? "Обновление на паузе" : `Данные обновляются сами каждые ${seconds} с`;

  // Кольцо заполняется до следующего обновления. Без подписи: подробности — в подсказке.
  return (
    <span className={paused ? "live-ring paused" : pending ? "live-ring pending" : "live-ring"} title={label} role="img" aria-label={label}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
        <circle cx="8" cy="8" r="6" className="live-ring-track" />
        <circle key={cycle} cx="8" cy="8" r="6" className="live-ring-fill" style={{ animationDuration: `${seconds}s` }} />
      </svg>
    </span>
  );
}
