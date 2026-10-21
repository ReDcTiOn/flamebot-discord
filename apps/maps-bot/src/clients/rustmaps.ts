import type { MapInfo } from "@flamebot/core";
import { filenameFromResponse, saveBody } from "../files.js";
import { log, sleep } from "../events.js";

const BASE_URL = "https://api.rustmaps.com";

export class RustMapsError extends Error {}

// API оборачивает ответы в {"meta": ..., "data": ...}.
function data(body: unknown): unknown {
  if (body && typeof body === "object" && "data" in body && "meta" in body) return (body as { data: unknown }).data;
  return body;
}

function errors(body: unknown, status?: number): string {
  if (status === 401 || status === 403) return "RustMaps не принял API-ключ (проверь его в панели, «Подключение»)";
  const errs = (body as { meta?: { errors?: unknown[] } } | null)?.meta?.errors;
  if (Array.isArray(errs) && errs.length) return errs.map(String).join("; ");
  return JSON.stringify(body ?? "").slice(0, 300);
}

export type RustMapsInfo = MapInfo & {
  url?: string;
  downloadUrl?: string;
  saveVersion?: number;
  imageUrl?: string;
  imageIconUrl?: string;
  thumbnailUrl?: string;
};

export interface RustMapsLimits {
  concurrentCurrent: number;
  concurrentAllowed: number;
  monthlyUsed: number;
  monthlyAllowed: number;
}

export class RustMapsClient {
  constructor(
    private readonly apiKey: string,
    private readonly orgId: string | null,
  ) {}

  private async request(method: string, path: string, body?: unknown): Promise<[number, unknown]> {
    const headers: Record<string, string> = { "X-API-Key": this.apiKey, Accept: "application/json" };
    if (this.orgId) headers["x-org-id"] = this.orgId;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(BASE_URL + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        const reset = res.headers.get("X-Rate-Limit-Reset") ?? "";
        const wait = /^\d+$/.test(reset) ? Number(reset) - Date.now() / 1000 : 10 * (attempt + 1);
        const sec = Math.min(Math.max(wait, 1), 90);
        log.info(`RustMaps 429, жду ${Math.round(sec)} с`);
        await res.body?.cancel();
        await sleep(sec * 1000);
        continue;
      }
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return [res.status, parsed];
    }
    throw new RustMapsError("RustMaps: превышен лимит запросов (429)");
  }

  async generateFromSavedConfig(configName: string, size: number, seed: number, staging: boolean): Promise<string> {
    // Фактический формат отличается от их swagger: параметры лежат в mapParameters.
    const [status, body] = await this.request("POST", "/v4/maps/custom/saved-config", {
      configName,
      mapParameters: { size, seed, staging },
    });
    if (status !== 200 && status !== 201) {
      throw new RustMapsError(
        `Генерация не принята (${status}): ${errors(body, status)} | config=${configName} size=${size} seed=${seed} | ответ: ${JSON.stringify(body).slice(0, 400)}`,
      );
    }
    const d = data(body) as { mapId?: string; id?: string } | null;
    const mapId = d && typeof d === "object" ? (d.mapId ?? d.id) : null;
    if (!mapId) throw new RustMapsError(`Не нашёл id карты в ответе: ${JSON.stringify(body).slice(0, 300)}`);
    return String(mapId);
  }

  async getLimits(): Promise<RustMapsLimits> {
    const [status, body] = await this.request("GET", "/v4/maps/limits");
    if (status !== 200) throw new RustMapsError(`limits ${status}: ${errors(body, status)}`);
    const d = (data(body) ?? {}) as { concurrent?: Record<string, number>; monthly?: Record<string, number> };
    const conc = d.concurrent ?? {};
    const month = d.monthly ?? {};
    return {
      concurrentCurrent: Number(conc.current ?? 0),
      concurrentAllowed: Number(conc.allowed ?? 0),
      monthlyUsed: Number(month.used ?? month.current ?? 0),
      monthlyAllowed: Number(month.allowed ?? 0),
    };
  }

  async listSavedConfigs(): Promise<string[]> {
    const [status, body] = await this.request("GET", "/v4/maps/custom/saved-configs");
    if (status !== 200) throw new RustMapsError(`saved-configs ${status}: ${errors(body, status)}`);
    const list = (data(body) ?? []) as { name?: string; configName?: string }[];
    return list.map((c) => c.name ?? c.configName ?? "").filter(Boolean);
  }

  async getMap(mapId: string): Promise<[number, RustMapsInfo | null]> {
    const [status, body] = await this.request("GET", `/v4/maps/${encodeURIComponent(mapId)}`);
    const d = data(body);
    return [status, d && typeof d === "object" && !Array.isArray(d) ? (d as RustMapsInfo) : null];
  }

  async waitUntilReady(mapId: string, timeoutMs = 2 * 3_600_000, pollMs = 15_000): Promise<RustMapsInfo> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [status, body] = await this.request("GET", `/v4/maps/${encodeURIComponent(mapId)}/status`);
      const state = status === 200 ? ((data(body) ?? {}) as { state?: string }).state : undefined;
      if (state === "Cancelled") throw new RustMapsError("Генерация отменена на стороне RustMaps");
      if (state === undefined || state === "Active") {
        // Статуса нет (404) или карта активна — пробуем забрать готовую карту.
        const [st, info] = await this.getMap(mapId);
        if (st === 200 && info) return info;
      }
      await sleep(pollMs);
    }
    throw new RustMapsError("Карта не сгенерировалась за отведённое время");
  }

  // Скачивает .map. Сначала без ключа (ссылка обычно подписана), при 401/403 — с ключом.
  async download(url: string, dest: string): Promise<{ size: number; filename: string | null }> {
    for (const headers of [{}, { "X-API-Key": this.apiKey }] as Record<string, string>[]) {
      const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(15 * 60_000) });
      if ((res.status === 401 || res.status === 403) && !headers["X-API-Key"]) {
        await res.body?.cancel();
        continue;
      }
      if (!res.ok) throw new RustMapsError(`Скачивание карты: ответ ${res.status}`);
      const size = await saveBody(res, dest);
      const expected = res.headers.get("content-length");
      if (expected && Number(expected) !== size && !res.headers.get("content-encoding")) {
        throw new RustMapsError(`Скачано ${size} байт из ${expected}`);
      }
      return { size, filename: filenameFromResponse(res) };
    }
    throw new RustMapsError("Не удалось скачать карту (401/403)");
  }

  async fetchImage(url: string, maxBytes = 9_000_000): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length <= maxBytes ? buf : null;
    } catch {
      return null;
    }
  }
}
