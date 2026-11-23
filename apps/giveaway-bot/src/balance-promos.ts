import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { GiveawayKeyError, loadFlameRustKey } from "./secrets.js";

export const QUICK_WINNERS = 5;
const amount = 50;
const week = 7 * 24 * 60 * 60 * 1000;
const responseSchema = z.object({ codes: z.array(z.string().min(1)).length(QUICK_WINNERS) });

const api = "https://api.flamerust.gg/api/v1/external/promo-codes";
const singlePromo = z.object({ code: z.string(), type: z.literal("balance"), amount_rub: z.number().optional(), amount_minor: z.number().optional() });

class PromoRequestError extends Error {
  constructor(message: string, readonly retryInMs = 60_000) {
    super(message);
  }
}

async function request(key: string, path: string, body?: object): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(api + path, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new PromoRequestError("flamerust.gg не ответил на запрос промокодов.");
  }
  if (response.ok || (body && response.status === 409)) return response;
  await response.body?.cancel().catch(() => undefined);
  if (response.status === 429) {
    const header = response.headers.get("Retry-After");
    const seconds = header && /^\d+$/.test(header) ? Number(header) : 60;
    throw new PromoRequestError("Достигнут лимит запросов flamerust.gg.", Math.min(86_400, Math.max(5, seconds)) * 1000);
  }
  if (response.status === 401 || response.status === 403) {
    throw new PromoRequestError("flamerust.gg отклонил запрос. Проверь ключ, права и белый список IP.");
  }
  throw new PromoRequestError(`flamerust.gg вернул HTTP ${response.status} при запросе промокодов.`);
}

function balancePromo(endsAt: Date, amountRub: number) {
  return {
    amount_rub: amountRub,
    max_uses_total: 1,
    max_uses_per_user: 1,
    one_time_per_user: true,
    starts_at: new Date().toISOString(),
    ends_at: new Date(endsAt.getTime() + week).toISOString(),
  };
}

export async function createQuickPromos(endsAt: Date): Promise<string[]> {
  const key = await loadFlameRustKey();
  const prefix = `GIVE-${randomBytes(5).toString("hex").toUpperCase()}-`;
  const response = await request(key, "/balance", { ...balancePromo(endsAt, amount), pattern: `${prefix}********`, count: QUICK_WINNERS });
  const result = responseSchema.safeParse(await response.json().catch(() => null));
  if (!result.success || new Set(result.data.codes.map(code => code.toUpperCase())).size !== QUICK_WINNERS
    || result.data.codes.some(code => !code.toUpperCase().startsWith(prefix))) {
    throw new Error("flamerust.gg не вернул пять уникальных кодов. Проверь последние коды в магазине перед повтором команды.");
  }
  return result.data.codes;
}

export async function createScheduledPromos(endsAt: Date, count: number, amountRub: number, seed: string): Promise<string[]> {
  const key = await loadFlameRustKey();
  const codes = Array.from({ length: count }, (_, i) =>
    `GIVE-${createHmac("sha256", seed).update(String(i)).digest("hex").slice(0, 24).toUpperCase()}`,
  );
  for (const code of codes) {
    const response = await request(key, "/balance", { ...balancePromo(endsAt, amountRub), code });
    if (response.status === 409) {
      await response.body?.cancel().catch(() => undefined);
      const check = await request(key, `/check?${new URLSearchParams({ code })}`);
      const existing = z.object({ exists: z.literal(true), promo: singlePromo }).safeParse(await check.json().catch(() => null));
      if (existing.success && existing.data.promo.code.toUpperCase() === code
        && (existing.data.promo.amount_rub ?? (existing.data.promo.amount_minor ?? 0) / 100) === amountRub) continue;
      throw new PromoRequestError("flamerust.gg сообщил о конфликте кода. Проверь розыгрыш в панели.");
    }
    const result = z.object({ code: z.string().optional(), codes: z.array(z.string()).optional(), promo: z.object({ code: z.string() }).optional() })
      .safeParse(await response.json().catch(() => null));
    if (!result.success || (result.data.promo?.code ?? result.data.codes?.[0] ?? result.data.code)?.toUpperCase() !== code) {
      throw new PromoRequestError("flamerust.gg не подтвердил создание кода. Бот проверит его при следующей попытке.");
    }
  }
  return codes;
}

export function promoRetry(err: unknown) {
  return {
    publishError: err instanceof PromoRequestError || err instanceof GiveawayKeyError
      ? err.message
      : "Не удалось подготовить промокоды flamerust.gg.",
    publishRetryAt: new Date(Date.now() + (err instanceof PromoRequestError ? err.retryInMs : 60_000)),
  };
}
