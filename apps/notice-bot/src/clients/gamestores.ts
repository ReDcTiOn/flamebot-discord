import type { PromoSpec } from "@flamebot/core";

// Клиент gamestores.app: список, создание и удаление промокодов.
// Ответ — {"result": "success"|"fail", "message", "data"}. Создание — непубличный метод,
// доступ к нему магазину выдаёт поддержка gamestores.

export class PromoError extends Error {}

export interface GameStores {
  storeId: string;
  secretKey: string;
}

export interface StorePromo {
  id?: number;
  code: string;
  type?: string;
  amount?: number;
  dateEnd?: string;
  used?: number;
}

const BASE = "https://api.gamestores.app/v1/";

async function request(gs: GameStores, method: "GET" | "POST", path: string, payload?: unknown): Promise<{ data?: unknown }> {
  const res = await fetch(BASE + path, {
    method,
    headers: { storeId: gs.storeId, secretKey: gs.secretKey, ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: { result?: string; message?: string; data?: unknown } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    // не JSON — разберём ниже
  }
  if (!data || typeof data !== "object") throw new PromoError(`HTTP ${res.status}: неожиданный ответ ${text.slice(0, 200)}`);
  if (res.status >= 300 || data.result !== "success") {
    const reason = data.message || JSON.stringify(data);
    throw new PromoError(res.status >= 300 ? `HTTP ${res.status}: ${reason.slice(0, 300)}` : reason.slice(0, 300));
  }
  return data;
}

// Объекты промокодов из ответа promocodes.list, где бы они ни лежали.
export function* iterPromos(data: unknown): Generator<StorePromo> {
  if (Array.isArray(data)) {
    for (const item of data) yield* iterPromos(item);
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.code === "string") yield obj as unknown as StorePromo;
    for (const v of Object.values(obj)) if (v && typeof v === "object") yield* iterPromos(v);
  }
}

export async function listPromos(gs: GameStores): Promise<StorePromo[]> {
  return [...iterPromos(await request(gs, "GET", "promocodes.list"))];
}

export async function findActive(gs: GameStores, code: string): Promise<StorePromo | null> {
  return (await listPromos(gs)).find((p) => p.code.toLowerCase() === code.toLowerCase()) ?? null;
}

export async function createPromo(gs: GameStores, spec: PromoSpec): Promise<{ id?: number }> {
  const res = await request(gs, "POST", "promocodes.create", {
    code: spec.code,
    type: spec.type,
    amount: spec.amount,
    dateEnd: spec.dateEnd,
    limitUses: spec.limitUses,
  });
  return (res.data ?? {}) as { id?: number };
}

export async function deletePromos(gs: GameStores, ids: number[]): Promise<void> {
  await request(gs, "POST", "promocodes.delete", { promocodesIds: ids });
}
