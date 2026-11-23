import { randomBytes } from "node:crypto";
import { z } from "zod";
import { loadFlameRustKey } from "./secrets.js";

export const QUICK_WINNERS = 5;
const amount = 50;
const week = 7 * 24 * 60 * 60 * 1000;
const responseSchema = z.object({ codes: z.array(z.string().min(1)).length(QUICK_WINNERS) });

export async function createQuickPromos(endsAt: Date): Promise<string[]> {
  const key = await loadFlameRustKey();
  const prefix = `GIVE-${randomBytes(5).toString("hex").toUpperCase()}-`;
  let response: Response;
  try {
    response = await fetch("https://api.flamerust.gg/api/v1/external/promo-codes/balance", {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        pattern: `${prefix}********`,
        count: QUICK_WINNERS,
        amount_rub: amount,
        max_uses_total: 1,
        max_uses_per_user: 1,
        one_time_per_user: true,
        starts_at: new Date().toISOString(),
        ends_at: new Date(endsAt.getTime() + week).toISOString(),
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new Error("flamerust.gg не подтвердил создание промокодов. Проверь последние коды в магазине перед повтором команды.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) {
      const header = response.headers.get("Retry-After");
      const wait = header && /^\d+$/.test(header) ? ` через ${header} с` : " позже";
      throw new Error(`Достигнут лимит flamerust.gg. Повтори команду${wait}.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("flamerust.gg отклонил запрос. Проверь ключ, права и белый список IP.");
    }
    throw new Error(`flamerust.gg вернул HTTP ${response.status} при создании промокодов.`);
  }
  const result = responseSchema.safeParse(await response.json().catch(() => null));
  if (!result.success || new Set(result.data.codes.map(code => code.toUpperCase())).size !== QUICK_WINNERS
    || result.data.codes.some(code => !code.toUpperCase().startsWith(prefix))) {
    throw new Error("flamerust.gg не вернул пять уникальных кодов. Проверь последние коды в магазине перед повтором команды.");
  }
  return result.data.codes;
}
