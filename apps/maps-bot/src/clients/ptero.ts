import { zonedParts, zonedToDate } from "@flamebot/core";
import { sleep } from "../events.js";

// Клиентский API Pterodactyl (ключ ptlc_…). Аддон Rust Server Wiper отдаёт задачи вайпа по
// GET /api/client/servers/{uuid}/wipe.

// Время задач в панели хранится по МСК (проверено по ran_at/updated_at), независимо от пояса расписания.
export const PTERO_TZ = "Europe/Moscow";

export class PterodactylError extends Error {}

export interface PteroWipe {
  id: number;
  name: string;
  description: string;
  size?: number | null;
  seed?: number | null;
  random_seed?: number;
  random_level?: number;
  level?: string | null;
  files?: string | null;
  blueprints?: number | boolean;
  time?: string | null;
  repeat?: unknown;
  closest?: string | null;
  relationships?: { commands?: { data?: { attributes: { command: string; time: unknown } }[] } };
}

// Ближайший запуск задачи (поле closest), по МСК.
export function nextRun(wipe: PteroWipe): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(wipe.closest ?? "");
  if (!m) return null;
  return zonedToDate({ year: +m[1]!, month: +m[2]!, day: +m[3]! }, { hour: +m[4]!, minute: +m[5]! }, PTERO_TZ);
}

const mskDay = (d: Date) => {
  const p = zonedParts(d, PTERO_TZ);
  return `${p.year}-${p.month}-${p.day}`;
};

// Задача, ближайший запуск которой приходится на день вайпа (по МСК).
export function wipeForDate(wipes: PteroWipe[], wipeAt: Date): PteroWipe | null {
  const day = mskDay(wipeAt);
  return wipes.find((w) => {
    const run = nextRun(w);
    return run !== null && mskDay(run) === day;
  }) ?? null;
}

export class PterodactylClient {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly apiKey: string,
  ) {
    this.base = baseUrl.replace(/\/+$/, "");
  }

  private async request(method: string, path: string, body?: unknown): Promise<Response> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(this.base + path, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status !== 429) return res;
      await res.body?.cancel();
      await sleep(5000 * (attempt + 1));
    }
    throw new PterodactylError("Панель отвечает 429 (слишком много запросов)");
  }

  async listWipes(uuid: string): Promise<PteroWipe[]> {
    const res = await this.request("GET", `/api/client/servers/${encodeURIComponent(uuid)}/wipe`);
    if (res.status === 401) {
      throw new PterodactylError("401: панель не приняла API-ключ для задач вайпа. Нужен клиентский ключ ptlc_ (Аккаунт → API Credentials)");
    }
    if (res.status !== 200) throw new PterodactylError(`GET wipe -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { wipes?: { data?: { attributes: PteroWipe }[] } };
    return (body.wipes?.data ?? []).map((w) => w.attributes);
  }

  // Меняет в задаче вайпа ссылку на карту (level) и флаг «Wipe Blueprints». Аддон сохраняет задачу
  // целиком (и пересоздаёт команды), поэтому в тело уходят все текущие значения из свежего чтения.
  // Формат тела снят с запроса «Update» в панели.
  async updateWipe(uuid: string, wipe: PteroWipe, level: string, blueprints: boolean): Promise<void> {
    const commands = (wipe.relationships?.commands?.data ?? []).map((c) => c.attributes);
    const payload = {
      name: wipe.name,
      description: wipe.description,
      size: wipe.size ?? null,
      seed: wipe.seed ?? null,
      random_seed: wipe.random_seed ?? 0,
      random_level: wipe.random_level ?? 0,
      level,
      files: wipe.files ?? "",
      commands: commands.map((c) => c.command),
      command_times: commands.map((c) => c.time),
      blueprints: blueprints ? 1 : 0,
      time: wipe.time ?? null,
      repeat: wipe.repeat ?? null,
    };
    const res = await this.request("POST", `/api/client/servers/${encodeURIComponent(uuid)}/wipe/${wipe.id}`, payload);
    if (res.status < 200 || res.status >= 300) throw new PterodactylError(`POST wipe/${wipe.id} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  // Принимает ли панель ключ и какие серверы ему доступны.
  async whoami(): Promise<{ status: number; servers: { id: string; name: string }[] }> {
    const res = await this.request("GET", "/api/client");
    if (res.status !== 200) return { status: res.status, servers: [] };
    const body = (await res.json()) as { data?: { attributes: { identifier: string; name: string } }[] };
    return { status: 200, servers: (body.data ?? []).map((d) => ({ id: d.attributes.identifier, name: d.attributes.name })) };
  }
}
