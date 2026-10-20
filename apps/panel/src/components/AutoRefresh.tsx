"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Перезапрашивает данные страницы с сервера, пока вкладка открыта и видна.
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
