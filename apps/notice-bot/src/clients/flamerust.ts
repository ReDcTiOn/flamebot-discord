const BASE = "https://api.flamerust.gg/api/v1/external/promo-codes";
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
let retryAt = 0;

function retryMessage() {
  return `превышен лимит запросов, повторите через ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} с`;
}

async function request(key: string, method: "GET" | "POST" | "DELETE", path: string, body?: object) {
  if (Date.now() < retryAt) throw new Error(retryMessage());
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(body && { "Content-Type": "application/json" }) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error("нет ответа от API flamerust.gg");
  }

  if (response.status === 429) {
    const header = response.headers.get("Retry-After");
    const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header ?? "") - Date.now();
    retryAt = Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : 60_000);
  }
  if (method === "DELETE" && response.status === 404) return response;
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 429) throw new Error(retryMessage());
    if (response.status === 401 || response.status === 403) throw new Error("проверьте ключ, права API и белый список IP");
    if (response.status === 409) throw new Error("код уже занят");
    throw new Error(`API вернул HTTP ${response.status}`);
  }
  return response;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export async function findFlamePromo(key: string, code: string): Promise<boolean> {
  const response = await request(key, "GET", `/check?${new URLSearchParams({ code })}`);
  const body = record(await response.json().catch(() => null));
  if (typeof body?.exists !== "boolean") {
    throw new Error("неизвестный формат проверки промокода flamerust.gg");
  }
  return body.exists;
}

export async function createFlamePromo(key: string, body: { code: string; starts_at: string; ends_at: string; discount_percent: number }): Promise<string | null> {
  const response = await request(key, "POST", "/discount", body);
  const result = record(await response.json().catch(() => null));
  const id = record(result?.promo)?.id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

export async function deleteFlamePromo(key: string, id: string): Promise<void> {
  if (!UUID.test(id)) throw new Error("неизвестный UUID промокода flamerust.gg");
  const response = await request(key, "DELETE", `/${id}`);
  await response.body?.cancel().catch(() => undefined);
}
