import { randomInt, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  MAPS_OPEN_CYCLES,
  botDataDir,
  fmtWipe,
  isBlueprintWipe,
  isStagingWipe,
  mapsRuleProblems,
  mapsSecretHint,
  poolOf,
  prisma,
  renderMapsTemplate,
  scorePool,
  upcomingWipes,
  type MapInfo,
  type MapScore,
  type MapsCandidate,
  type MapsCycle,
  type MapsSlot,
  Prisma,
  type Wipe,
} from "@flamebot/core";
import { nextRun, wipeForDate } from "./clients/ptero.js";
import { sendWebhook } from "./clients/discord.js";
import { RustMapsError, type RustMapsInfo } from "./clients/rustmaps.js";
import { TelegramError, TelegramNetworkError, type InlineKeyboard, type Markup } from "./clients/telegram.js";
import { config } from "./config.js";
import { errorText, event, log, sleep } from "./events.js";
import { downloadUrl, fileSize } from "./files.js";
import * as msg from "./messages.js";
import { ctx, serverTitle } from "./state.js";

const TG_RETRY_DELAYS = [2, 5, 10, 20];
const RECONCILE_EVERY_MS = 60_000;
const HOUR_MS = 3_600_000;

const isOpen = (c: MapsCycle | null): c is MapsCycle => !!c && (MAPS_OPEN_CYCLES as readonly string[]).includes(c.status);
const info = (s: { info: Prisma.JsonValue | null }) => (s.info ?? {}) as RustMapsInfo;

// Все изменения состояния карт идут по одному: Postgres, в отличие от прежнего SQLite, отвечает
// асинхронно, и без очереди два одновременных нажатия могли бы выдать одну карту двум серверам.
// Долгие операции (генерация, скачивание, загрузка в S3) выполняются вне очереди,
// а их результат записывается через неё.
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(fn);
  chain = run.catch(() => undefined);
  return run;
}

// Генерации заказываются по одной: перед заказом бот ждёт свободный слот в лимитах RustMaps.
let genChain: Promise<unknown> = Promise.resolve();
function genLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = genChain.catch(() => undefined).then(fn);
  genChain = run.catch(() => undefined);
  return run;
}

function spawn(what: string, p: Promise<unknown>): void {
  p.catch((err) => log.error(`Сбой фоновой задачи: ${what}`, err));
}

export const tmpDir = () => join(botDataDir(), "tmp");

async function sha1(path: string): Promise<string> {
  const h = createHash("sha1");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

// ====================================================================== Telegram
// Telegram — это оформление, а не логика: его сбой никогда не прерывает работу с картами.
// Не дошедшее досылает reconcileIfDue. Если Telegram не принял токен, минуту к нему не обращаемся,
// чтобы действия из панели не ждали заведомо неудачных попыток.
let tgBlockedUntil = 0;

async function tg<T>(fn: (t: NonNullable<ReturnType<typeof ctx>["telegram"]>) => Promise<T>): Promise<T | null> {
  const t = ctx().telegram;
  if (!t || !ctx().chatId || Date.now() < tgBlockedUntil) return null;
  for (const delay of [...TG_RETRY_DELAYS, null]) {
    try {
      return await fn(t);
    } catch (err) {
      if (err instanceof TelegramError && (err.code === 401 || err.code === 404)) {
        tgBlockedUntil = Date.now() + 60_000;
        throw err;
      }
      if (delay === null) throw err;
      if (err instanceof TelegramError && err.retryAfter) await sleep((err.retryAfter + 1) * 1000);
      else if (err instanceof TelegramNetworkError) {
        log.info(`${err.message}, повтор через ${delay} с`);
        await sleep(delay * 1000);
      } else throw err;
    }
  }
  return null;
}

const parseError = (err: unknown) => err instanceof TelegramError && /parse entities/i.test(err.description);

// Возвращает id сообщения или null, если отправить не удалось.
async function notify(text: string, markup?: Markup | null): Promise<number | null> {
  const chat = ctx().chatId;
  if (!chat) return null;
  try {
    return (await tg((t) => t.sendMessage(chat, text, markup)))?.message_id ?? null;
  } catch (err) {
    if (parseError(err)) {
      log.error(`Telegram не принял разметку, отправляю простым текстом: ${msg.plain(text).slice(0, 80)}`, err);
      try {
        return (await tg((t) => t.sendMessage(chat, msg.plain(text), markup, false)))?.message_id ?? null;
      } catch (err2) {
        err = err2;
      }
    }
    log.warn("Не удалось отправить сообщение в Telegram (досылка сработает сама)", err);
    return null;
  }
}

// Правка сообщения — это оформление, а не логика: сбой Telegram после повторов только пишем в лог.
async function edit(messageId: number, text: string, markup: InlineKeyboard | null): Promise<void> {
  const chat = ctx().chatId;
  if (!chat) return;
  try {
    await tg((t) => t.editMessageText(chat, messageId, text, markup));
  } catch (err) {
    if (parseError(err)) {
      await tg((t) => t.editMessageText(chat, messageId, msg.plain(text), markup, false)).catch((e2) => log.warn(`Правка сообщения ${messageId}`, e2));
    } else if (!(err instanceof TelegramError && /not modified/i.test(err.description))) {
      log.warn(`Не удалось поправить сообщение ${messageId}`, err);
    }
  }
}

async function dropMessage(messageId: number | null): Promise<void> {
  const chat = ctx().chatId;
  if (!messageId || !chat) return;
  await tg((t) => t.deleteMessage(chat, messageId)).catch((err) => log.info(`Не удалось удалить сообщение ${messageId}: ${errorText(err)}`));
}

// ====================================================================== данные
const getCycle = (id: string) => prisma.mapsCycle.findUnique({ where: { id } });
const getSlot = (id: number) => prisma.mapsSlot.findUnique({ where: { id } });
const slotsFor = (cycleId: string) => prisma.mapsSlot.findMany({ where: { cycleId }, orderBy: { serverId: "asc" } });
const cyclesBy = (...status: string[]) => prisma.mapsCycle.findMany({ where: { status: { in: status } }, orderBy: { wipeAt: "asc" } });
const updateSlot = (id: number, data: Prisma.MapsSlotUpdateInput) => prisma.mapsSlot.update({ where: { id }, data });
const updateCycle = (id: string, data: Prisma.MapsCycleUpdateInput) => prisma.mapsCycle.update({ where: { id }, data });
const updateCand = (id: number, data: Prisma.MapsCandidateUpdateInput) => prisma.mapsCandidate.update({ where: { id }, data });

const countCands = (cycleId: string, size: number, config: string, ...status: string[]) =>
  prisma.mapsCandidate.count({ where: { cycleId, size, config, status: { in: status } } });

// Готовые карты, доступные серверу: свежие (slotId пуст) и отложенные им самим.
const readyCands = (cycleId: string, size: number, config: string, slotId: number) =>
  prisma.mapsCandidate.findMany({ where: { cycleId, size, config, status: "ready", OR: [{ slotId: null }, { slotId }] }, orderBy: { id: "asc" } });

const countReady = (cycleId: string, size: number, config: string, slotId: number | null = null) =>
  prisma.mapsCandidate.count({ where: { cycleId, size, config, status: "ready", OR: [{ slotId: null }, ...(slotId === null ? [] : [{ slotId }])] } });

async function nextOrder(): Promise<number> {
  const a = await prisma.mapsCandidate.aggregate({ _max: { rejectedOrder: true, parkedOrder: true } });
  return Math.max(a._max.rejectedOrder ?? 0, a._max.parkedOrder ?? 0) + 1;
}

const lastRejected = (slotId: number) =>
  prisma.mapsCandidate.findFirst({ where: { slotId, status: "rejected", rejectedOrder: { not: null } }, orderBy: { rejectedOrder: "desc" } });

async function lastCandError(cycleId: string, size: number, config: string): Promise<string | null> {
  const row = await prisma.mapsCandidate.findFirst({ where: { cycleId, size, config, status: "error" }, orderBy: { id: "desc" } });
  return row?.error ?? null;
}

const fmt = (d: Date) => fmtWipe(d, ctx().settings.timezone, ctx().settings.timezoneLabel);
const panelAskMs = () => ctx().settings.panelAskHours * HOUR_MS;
const panelAutoMs = () => ctx().settings.panelAutoMinutes * 60_000;
const panelRemindMs = () => ctx().settings.panelRemindMinutes * 60_000;
const cyclePanelUrl = (cycleId: string) => (config.PANEL_URL ? `${config.PANEL_URL}/maps/cycles/${encodeURIComponent(cycleId)}` : null);

// ====================================================================== сервис
export class MapsService {
  private sending = new Set<number>(); // слоты, карточка которых отправляется прямо сейчас (защита от дублей)
  private reconciledAt = 0;
  private reconciling = false;

  // ---------------------------------------------------------------- цикл вайпа
  // Методы, обёрнутые в serial, вызываются только снаружи (Telegram, панель, таймеры).
  // Изнутри очереди — только их внутренние версии, иначе очередь будет ждать сама себя.
  async tick(now = new Date()): Promise<void> {
    const c = ctx();
    const { sendLeadHours, genLeadHours, timezone } = c.settings;
    if (c.rustmaps) {
      for (const wipe of upcomingWipes(c.rules, timezone, now)) {
        const startAt = wipe.wipeAt.getTime() - (sendLeadHours + genLeadHours) * HOUR_MS;
        if (now.getTime() >= startAt && !(await getCycle(wipe.id))) await this.startCycle(wipe);
      }
    }
    // Авто-отправка анонса в назначенное время.
    for (const cycle of await cyclesBy("scheduled")) if (now >= cycle.sendAt) await this.sendDiscordInner(cycle.id);
    // Время анонса прошло, а карты подтверждены не все: предупредить один раз.
    for (const cycle of await cyclesBy("generating")) {
      if (now >= cycle.sendAt && !cycle.warned) {
        await updateCycle(cycle.id, { warned: true });
        const pending = (await slotsFor(cycle.id)).filter((s) => s.status !== "uploaded").map((s) => `FR #${s.serverId}`);
        await notify(msg.announceOverdue(fmt(cycle.sendAt), pending));
        event("cycle.overdue", `Вайп ${fmt(cycle.wipeAt)}: время анонса наступило, а карты не готовы (${pending.join(", ")})`, { level: "WARN", details: { cycleId: cycle.id } });
      }
    }
    if (c.ptero) await this.panelTick(now);
  }

  // Самолечение: досылает то, что не дошло из-за сбоя Telegram (карточки, предложение автоподбора, вопрос про анонс).
  async reconcileIfDue(now = new Date()): Promise<void> {
    if (!ctx().telegram || this.reconciling || Date.now() - this.reconciledAt < RECONCILE_EVERY_MS) return;
    this.reconciling = true;
    this.reconciledAt = Date.now();
    try {
      for (const cycle of await cyclesBy(...MAPS_OPEN_CYCLES)) {
        if (cycle.wipeAt <= now) continue;
        try {
          if (cycle.autoMode) {
            if (cycle.autoMsgId === null) await this.autoProposal(cycle.id);
          } else {
            for (const s of await slotsFor(cycle.id)) {
              if (s.status === "ready" && !s.tgMsgId) await this.sendCard(s.id);
              else if (s.status === "error" && !s.tgMsgId) await this.refreshCard(s.id);
            }
          }
          if ((cycle.status === "scheduled" || cycle.status === "awaiting_discord") && !cycle.promptMsgId) await this.postPrompt(cycle.id);
        } catch (err) {
          log.warn(`Не удалось дослать сообщения цикла ${cycle.id}, попробую позже`, err);
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  async startCycle(wipe: Wipe): Promise<void> {
    const c = ctx();
    const rule = c.rules.find((r) => r.key === wipe.rule.key)!;
    const problems = mapsRuleProblems(rule, [...c.servers.values()]);
    if (problems.length) {
      log.warn(`Правило «${rule.key}» настроено с ошибками, генерация на ${fmt(wipe.wipeAt)} не запущена: ${problems.join("; ")}`);
      return;
    }
    const { timezone, autoPick } = c.settings;
    const sendAt = new Date(wipe.wipeAt.getTime() - c.settings.sendLeadHours * HOUR_MS);
    const staging = isStagingWipe(wipe.wipeAt, timezone);
    const blueprints = isBlueprintWipe(rule, wipe.wipeAt, timezone);
    const groups = new Map<string, { size: number; config: string }>();
    await prisma.$transaction(async (tx) => {
      await tx.mapsCycle.create({ data: { id: wipe.id, ruleKey: rule.key, wipeAt: wipe.wipeAt, sendAt, status: "generating", staging, blueprints, autoMode: autoPick } });
      for (const sid of rule.serverIds) {
        const srv = c.servers.get(sid)!;
        await tx.mapsSlot.create({ data: { cycleId: wipe.id, serverId: sid, size: srv.size, config: srv.savedConfig, status: "waiting" } });
        groups.set(`${srv.size}:${srv.savedConfig}`, { size: srv.size, config: srv.savedConfig });
      }
    });
    const plan: string[] = [];
    for (const { size, config } of groups.values()) plan.push(`${await this.startBatch(wipe.id, size, config)}×${size}`);
    event("cycle.started", `Вайп ${fmt(wipe.wipeAt)}: генерация карт запущена (${plan.join(", ")})`, { details: { cycleId: wipe.id, staging, blueprints, auto: autoPick } });
    await notify(msg.cycleStarted(fmt(wipe.wipeAt), staging, blueprints, plan, rule.serverIds.length, fmt(sendAt), autoPick, cyclePanelUrl(wipe.id)));
  }

  // /gen: предстоящие вайпы, для которых генерация ещё не начата.
  async genableWipes(): Promise<[string, string][]> {
    const c = ctx();
    const out: [string, string][] = [];
    for (const w of upcomingWipes(c.rules, c.settings.timezone)) {
      if (await getCycle(w.id)) continue;
      const flag = (isStagingWipe(w.wipeAt, c.settings.timezone) ? " 🧪" : "") + (isBlueprintWipe(w.rule, w.wipeAt, c.settings.timezone) ? " 🧹" : "");
      out.push([w.id, `${fmt(w.wipeAt)} · серверы ${w.rule.serverIds.join(",")}${flag}`]);
    }
    return out.slice(0, 6);
  }

  // Запустить генерацию на вайп раньше расписания.
  startWipe(wipeId: string): Promise<string> {
    return serial(async () => {
      const c = ctx();
      if (!c.rustmaps) return "Не задан API-ключ RustMaps";
      const w = upcomingWipes(c.rules, c.settings.timezone).find((x) => x.id === wipeId);
      if (!w) return "Этот вайп уже не актуален";
      if (await getCycle(wipeId)) return "Для этого вайпа генерация уже запущена";
      await this.startCycle(w);
      return (await getCycle(wipeId)) ? "Генерация запущена" : "Правило вайпа настроено с ошибками, подробности в истории";
    });
  }

  // Подхватить незавершённое после перезапуска бота.
  async resume(): Promise<void> {
    await rm(tmpDir(), { recursive: true, force: true });
    await mkdir(tmpDir(), { recursive: true });
    for (const cand of await prisma.mapsCandidate.findMany({ where: { status: "queued" } })) spawn("генерация", this.runCandidate(cand.id));
    for (const cand of await prisma.mapsCandidate.findMany({ where: { status: "generating" } })) {
      spawn("генерация", cand.rmMapId ? this.pollCandidate(cand.id) : this.runCandidate(cand.id));
    }
    for (const s of await prisma.mapsSlot.findMany({ where: { status: "uploading" } })) {
      await updateSlot(s.id, { status: "ready" });
      await this.refreshCard(s.id).catch((err) => log.warn("Карточка после перезапуска", err));
    }
    await prisma.mapsCycle.updateMany({ where: { status: "sending" }, data: { status: "scheduled" } });
    for (const cycle of await cyclesBy(...MAPS_OPEN_CYCLES)) {
      if (cycle.autoMsgId === -1) await updateCycle(cycle.id, { autoMsgId: null }); // предложение не успело отправиться до остановки
      await this.safeDispatch(cycle.id);
    }
    for (const cycle of await cyclesBy("generating")) await this.maybePromptDiscord(cycle.id).catch((err) => log.warn("Вопрос про анонс", err));
  }

  // ---------------------------------------------------------------- генерация
  // Заказывает пачку генераций (размер из пула правила). Возвращает, сколько карт заказано.
  private async startBatch(cycleId: string, size: number, config: string): Promise<number> {
    const cycle = (await getCycle(cycleId))!;
    const rule = ctx().rules.find((r) => r.key === cycle.ruleKey);
    const count = rule ? (poolOf(rule)[config] ?? 1) : 1;
    for (let i = 0; i < count; i++) {
      const cand = await prisma.mapsCandidate.create({ data: { cycleId, size, config, status: "queued" } });
      spawn("генерация", this.runCandidate(cand.id));
    }
    return count;
  }

  private async runCandidate(candId: number): Promise<void> {
    const cand = await prisma.mapsCandidate.findUnique({ where: { id: candId }, include: { cycle: true } });
    if (!cand) return;
    try {
      await genLock(async () => {
        const rm = ctx().rustmaps;
        if (!rm) throw new RustMapsError("Не задан API-ключ RustMaps");
        await this.waitForSlot();
        const seed = randomInt(1, 2_147_483_001);
        const rmMapId = await rm.generateFromSavedConfig(cand.config, cand.size, seed, cand.cycle.staging);
        await updateCand(candId, { seed, rmMapId, status: "generating", error: null });
      });
      await this.pollCandidate(candId);
    } catch (err) {
      log.warn(`Генерация карты не удалась (цикл ${cand.cycleId}, ${cand.size})`, err);
      await serial(async () => {
        await updateCand(candId, { status: "error", error: errorText(err).slice(0, 300) });
        await this.safeDispatch(cand.cycleId);
      });
    }
  }

  private async waitForSlot(): Promise<void> {
    for (;;) {
      const rm = ctx().rustmaps;
      if (!rm) return;
      let lim;
      try {
        lim = await rm.getLimits();
      } catch (err) {
        log.warn("Не удалось получить лимиты RustMaps", err);
        return;
      }
      if (lim.monthlyAllowed && lim.monthlyUsed >= lim.monthlyAllowed) {
        throw new RustMapsError(`Месячный лимит генераций исчерпан (${lim.monthlyUsed}/${lim.monthlyAllowed})`);
      }
      if (!lim.concurrentAllowed || lim.concurrentCurrent < lim.concurrentAllowed) return;
      await sleep(30_000);
    }
  }

  private async pollCandidate(candId: number): Promise<void> {
    const cand = await prisma.mapsCandidate.findUnique({ where: { id: candId } });
    if (!cand?.rmMapId) return;
    let result: Prisma.MapsCandidateUpdateInput;
    try {
      const rm = ctx().rustmaps;
      if (!rm) throw new RustMapsError("Не задан API-ключ RustMaps");
      const mapInfo = await rm.waitUntilReady(cand.rmMapId);
      result = { status: "ready", error: null, viewUrl: mapInfo.url ?? null, info: mapInfo as Prisma.InputJsonValue };
      log.info(`Карта ${candId} готова (цикл ${cand.cycleId}, ${cand.size})`);
    } catch (err) {
      log.warn(`Не дождался карты ${candId} с RustMaps`, err);
      result = { status: "error", error: errorText(err).slice(0, 300) };
    }
    await serial(async () => {
      await updateCand(candId, result);
      await this.safeDispatch(cand.cycleId);
    });
  }

  // dispatch, который не роняет задачу генерации: сбой Telegram оставляет карту в базе, а досылку берёт на себя reconcile.
  private async safeDispatch(cycleId: string): Promise<void> {
    try {
      await this.dispatch(cycleId);
    } catch (err) {
      log.warn(`Не удалось раздать карты цикла ${cycleId} (досылка сработает сама)`, err);
    }
  }

  // Оценки всех карт группы (размер + конфиг) цикла, по которым есть данные. Рельеф сравнивается внутри набора.
  async groupScores(cycleId: string, size: number, config: string): Promise<Map<number, MapScore>> {
    const cands = await prisma.mapsCandidate.findMany({
      where: { cycleId, size, config, status: { in: ["ready", "assigned", "rejected"] } },
      orderBy: { id: "asc" },
    });
    const withInfo = cands.filter((c) => c.info !== null);
    const scores = scorePool(withInfo.map((c) => c.info as MapInfo), size, ctx().scoring);
    return new Map(withInfo.map((c, i) => [c.id, scores[i]!]));
  }

  // Карта для сервера: сначала отложенная им «Назад» (последняя), иначе лучшая по оценке среди свежих.
  private async pickCandidate(cycleId: string, slot: MapsSlot): Promise<MapsCandidate | null> {
    const ready = await readyCands(cycleId, slot.size, slot.config, slot.id);
    const parked = ready.filter((c) => c.slotId === slot.id);
    if (parked.length) return parked.reduce((a, b) => ((b.parkedOrder ?? 0) > (a.parkedOrder ?? 0) ? b : a));
    const fresh = ready.filter((c) => c.slotId === null);
    if (!fresh.length) return null;
    const scores = await this.groupScores(cycleId, slot.size, slot.config);
    const val = (c: MapsCandidate) => scores.get(c.id)?.total ?? -1;
    return fresh.reduce((best, c) => (val(c) > val(best) || (val(c) === val(best) && c.id < best.id) ? c : best));
  }

  // Раздаёт готовые карты из пула серверам, которые ждут карту; нет ни готовых, ни в работе — ошибка.
  // В автоподборе карты выдаются, когда пул группы готов целиком (чтобы выбрать лучшие), карточки не шлются:
  // вместо них одно предложение с кнопками.
  async dispatch(cycleId: string): Promise<void> {
    const cycle = await getCycle(cycleId);
    if (!isOpen(cycle)) return;
    const auto = cycle.autoMode;
    for (const { id } of await slotsFor(cycleId)) {
      const slot = (await getSlot(id))!;
      if (slot.status !== "waiting") continue;
      const pending = await countCands(cycleId, slot.size, slot.config, "queued", "generating");
      if (auto && pending) continue;
      const cand = await this.pickCandidate(cycleId, slot);
      if (cand) {
        await updateCand(cand.id, { status: "assigned", slotId: slot.id, parkedOrder: null });
        await updateSlot(slot.id, {
          status: "ready",
          error: null,
          candId: cand.id,
          seed: cand.seed,
          rmMapId: cand.rmMapId,
          info: cand.info ?? Prisma.DbNull,
          viewUrl: cand.viewUrl,
        });
        if (!auto) await this.safe(this.sendCard(slot.id), `карточка сервера ${slot.serverId}`);
      } else if (!pending) {
        const err = await lastCandError(cycleId, slot.size, slot.config);
        await updateSlot(slot.id, { status: "error", error: err ?? "Пул карт пуст" });
        if (!auto) await this.safe(this.refreshCard(slot.id), `карточка ошибки сервера ${slot.serverId}`);
      }
    }
    if (auto) await this.safe(this.autoProposal(cycleId), "предложение автоподбора");
  }

  private async safe(p: Promise<unknown>, what: string): Promise<void> {
    try {
      await p;
    } catch (err) {
      log.warn(`Не удалось отправить: ${what} (досылка сработает сама)`, err);
    }
  }

  // ---------------------------------------------------------------- карточки
  async cardText(s: MapsSlot): Promise<[string, InlineKeyboard | null]> {
    const cycle = (await getCycle(s.cycleId))!;
    const card: msg.Card = {
      title: serverTitle(s.serverId),
      wipe: fmt(cycle.wipeAt),
      status: s.status,
      staging: cycle.staging,
      blueprints: cycle.blueprints,
      manual: s.source === "manual",
      seed: s.seed,
      size: s.size,
      config: s.config,
      attempt: s.attempt,
      info: {},
      viewUrl: s.viewUrl,
      cdnUrl: s.cdnUrl,
      error: s.error,
      spare: 0,
      coming: 0,
      panelOn: this.panelOn(s.serverId),
      panelSynced: s.panelSynced,
      panelNote: s.panelNote,
      panelHours: ctx().settings.panelAskHours,
      score: null,
      scoreParts: null,
    };
    let kb: InlineKeyboard | null = null;
    if (s.status === "ready") {
      card.info = info(s);
      card.spare = await countReady(s.cycleId, s.size, s.config, s.id);
      card.coming = await countCands(s.cycleId, s.size, s.config, "queued", "generating");
      const sc = s.candId ? (await this.groupScores(s.cycleId, s.size, s.config)).get(s.candId) : undefined;
      if (sc) [card.score, card.scoreParts] = [sc.total, [sc.rt, sc.spread, sc.terrain, sc.extra]];
      const prev = await lastRejected(s.id);
      kb = msg.kbCardReady(s.id, prev?.seed ?? null);
    } else if (s.status === "error") kb = msg.kbCardError(s.id);
    return [msg.mapCard(card), kb];
  }

  async sendCard(slotId: number): Promise<void> {
    if (!ctx().telegram || this.sending.has(slotId)) return; // уже отправляется (например, параллельно сработала досылка)
    this.sending.add(slotId);
    try {
      await this.sendCardInner(slotId);
    } catch (err) {
      log.warn(`Карточка сервера не отправилась в Telegram (досылка сработает сама)`, err);
    } finally {
      this.sending.delete(slotId);
    }
  }

  private async sendCardInner(slotId: number): Promise<void> {
    const s = await getSlot(slotId);
    if (!s || s.tgMsgId) return;
    const [text, kb] = await this.cardText(s);
    // Картинка отдельным сообщением: подпись к фото ограничена 1024 символами, а чек-лист РТ длиннее.
    let photoId = s.tgPhotoMsgId; // уже ушла при прошлой неудачной попытке, второй раз не шлём
    const i = info(s);
    const rm = ctx().rustmaps;
    for (const key of photoId || !rm ? [] : (["imageIconUrl", "imageUrl", "thumbnailUrl"] as const)) {
      const url = i[key];
      const image = url ? await rm!.fetchImage(url) : null;
      if (!image) continue;
      try {
        const sent = await tg((t) => t.sendPhoto(ctx().chatId!, image, msg.photoCaption(serverTitle(s.serverId), s.seed, s.size)));
        if (sent) {
          photoId = sent.message_id;
          await updateSlot(slotId, { tgPhotoMsgId: photoId });
        }
        break;
      } catch (err) {
        if (!(err instanceof TelegramError) || err.code === 401 || err.code === 404) throw err;
        log.info(`Фото карты (${key}) не прошло: ${err.description}`);
      }
    }
    const messageId = await notify(text, kb);
    await updateSlot(slotId, { tgMsgId: messageId, tgPhotoMsgId: photoId });
  }

  async refreshCard(slotId: number): Promise<void> {
    if (!ctx().telegram) return;
    const s = await getSlot(slotId);
    if (!s) return;
    const [text, kb] = await this.cardText(s);
    if (s.tgMsgId) await edit(s.tgMsgId, text, kb);
    else if (!this.sending.has(slotId)) {
      this.sending.add(slotId);
      try {
        await updateSlot(slotId, { tgMsgId: await notify(text, kb) });
      } finally {
        this.sending.delete(slotId);
      }
    }
  }

  // ---------------------------------------------------------------- действия с картами
  private async openCycleFor(s: MapsSlot): Promise<string | null> {
    return isOpen(await getCycle(s.cycleId)) ? null : "Анонс по этому вайпу уже отправлен";
  }

  // Освобождает сервер: текущая карта уходит в историю (для «Назад»), сервер ждёт новую.
  private async releaseSlot(s: MapsSlot, note: string): Promise<void> {
    if (s.candId) await updateCand(s.candId, { status: "rejected", rejectedOrder: await nextOrder() });
    if (s.tgMsgId) await edit(s.tgMsgId, note, null);
    await dropMessage(s.tgPhotoMsgId);
    await updateSlot(s.id, {
      status: "waiting",
      source: "rustmaps",
      attempt: s.attempt + 1,
      seed: null,
      rmMapId: null,
      candId: null,
      info: Prisma.DbNull,
      viewUrl: null,
      s3Key: null,
      cdnUrl: null,
      error: null,
      panelSynced: false,
      panelNote: null,
      tgMsgId: null,
      tgPhotoMsgId: null,
    });
  }

  // «Заменить»: берём следующую готовую карту из пула, если пул пуст, генерируется новая пачка.
  reroll(slotId: number): Promise<string> {
    return serial(async () => {
      const s = await getSlot(slotId);
      if (!s || (s.status !== "ready" && s.status !== "error")) return "Эту карту уже нельзя заменить";
      const why = await this.openCycleFor(s);
      if (why) return why;
      await this.releaseSlot(s, s.status === "ready" ? msg.noteSkipped(s.seed) : msg.noteRegen());
      const hasReady = (await readyCands(s.cycleId, s.size, s.config, slotId)).length > 0;
      const coming = await countCands(s.cycleId, s.size, s.config, "queued", "generating");
      let batch = 0;
      if (!hasReady && !coming) {
        batch = await this.startBatch(s.cycleId, s.size, s.config);
        await notify(msg.poolExhausted(s.size, batch));
      }
      await this.dispatch(s.cycleId);
      if (hasReady) return "Подставлена готовая карта";
      return batch ? "Запас закончился, генерирую новую пачку" : "Готовых нет, жду генерацию из пула";
    });
  }

  // «Назад»: вернуть предыдущую пропущенную карту сервера. Текущая откладывается и вернётся по «Заменить».
  goBack(slotId: number): Promise<string> {
    return serial(async () => {
      const s = await getSlot(slotId);
      if (!s || s.status !== "ready") return "Сейчас нельзя вернуться";
      const why = await this.openCycleFor(s);
      if (why) return why;
      const prev = await lastRejected(slotId);
      if (!prev) return "Предыдущих карт нет";
      let cur = s.candId;
      if (!cur) {
        // Карта без записи в пуле (например, из старой версии): заводим запись, чтобы не потерять.
        cur = (
          await prisma.mapsCandidate.create({
            data: { cycleId: s.cycleId, size: s.size, config: s.config, status: "ready", seed: s.seed, rmMapId: s.rmMapId, info: s.info ?? Prisma.DbNull, viewUrl: s.viewUrl, slotId },
          })
        ).id;
      }
      await updateCand(cur, { status: "ready", parkedOrder: await nextOrder() });
      await updateCand(prev.id, { status: "assigned", rejectedOrder: null, parkedOrder: null });
      if (s.tgMsgId) await edit(s.tgMsgId, msg.noteBack(prev.seed, s.seed), null);
      await dropMessage(s.tgPhotoMsgId);
      await updateSlot(slotId, {
        status: "ready",
        attempt: s.attempt + 1,
        seed: prev.seed,
        rmMapId: prev.rmMapId,
        candId: prev.id,
        info: prev.info ?? Prisma.DbNull,
        viewUrl: prev.viewUrl,
        error: null,
        tgMsgId: null,
        tgPhotoMsgId: null,
      });
      await this.safe(this.sendCard(slotId), "карточка после «Назад»");
      return "Вернул предыдущую карту";
    });
  }

  // ---------------------------------------------------------------- изменить карты (/reset)
  async resetTargets(): Promise<[string, string][]> {
    return (await cyclesBy(...MAPS_OPEN_CYCLES)).map((c) => [c.id, `${fmt(c.wipeAt)} · ${c.status}`]);
  }

  async resetSummary(cycleId: string): Promise<string> {
    const c = await getCycle(cycleId);
    if (!c) return "Цикл не найден";
    const slots = (await slotsFor(cycleId)).map((s): [string, boolean, string] => [serverTitle(s.serverId), s.source === "manual", s.status]);
    return msg.resetMenu(fmt(c.wipeAt), c.status, slots);
  }

  // Отменяет автоотправку: цикл снова ждёт подтверждения карт.
  private async reopenCycle(cycle: MapsCycle): Promise<void> {
    await updateCycle(cycle.id, { status: "generating", warned: false });
    await this.panelReopen(cycle.id, false);
    if (cycle.promptMsgId) await edit(cycle.promptMsgId, msg.reopened(), null);
  }

  private async resetChecks(cycleId: string): Promise<[MapsCycle | null, string]> {
    const cycle = await getCycle(cycleId);
    if (!isOpen(cycle)) return [null, "Анонс по этому вайпу уже отправлен (или цикл не найден)"];
    if ((await slotsFor(cycleId)).some((s) => s.status === "uploading")) return [null, "Идёт загрузка карты, подождите минуту"];
    return [cycle, ""];
  }

  // Снять подтверждения: те же карты возвращаются к выбору.
  unconfirm(cycleId: string): Promise<string> {
    return serial(async () => {
      const [cycle, why] = await this.resetChecks(cycleId);
      if (!cycle) return why;
      const uploaded = (await slotsFor(cycleId)).filter((s) => s.status === "uploaded");
      if (!uploaded.length) return "Подтверждённых карт нет";
      for (const s of uploaded) {
        if (s.source === "manual") await this.releaseSlot(s, msg.noteManualReleased()); // ручная карта: сервер получает карту из пула
        else {
          await updateSlot(s.id, { status: "ready", s3Key: null, cdnUrl: null, error: null, panelSynced: false, panelNote: null });
          await this.refreshCard(s.id);
        }
      }
      await this.reopenCycle(cycle);
      await this.dispatch(cycleId);
      return `Подтверждения сняты: ${uploaded.length}`;
    });
  }

  // Заменить все карты вайпа (в том числе подтверждённые): следующие из пула, при нехватке новая пачка.
  replaceAll(cycleId: string): Promise<string> {
    return serial(async () => {
      const [cycle, why] = await this.resetChecks(cycleId);
      if (!cycle) return why;
      for (const s of await slotsFor(cycleId)) if (["ready", "error", "uploaded"].includes(s.status)) await this.releaseSlot(s, msg.noteAllReplaced());
      await this.reopenCycle(cycle);
      const batches = await this.fillPool(cycleId);
      await this.dispatch(cycleId);
      return `Карты заменены. Новых генераций заказано: ${batches}`;
    });
  }

  // Для серверов, которые ждут карту, заказывает новую пачку там, где готовых и генерируемых карт не хватает.
  private async fillPool(cycleId: string): Promise<number> {
    let batches = 0;
    const waiting = (await slotsFor(cycleId)).filter((s) => s.status === "waiting");
    const groups = new Map(waiting.map((s) => [`${s.size}:${s.config}`, s]));
    for (const s of groups.values()) {
      const need = waiting.filter((w) => w.size === s.size && w.config === s.config).length;
      const fresh = await countReady(cycleId, s.size, s.config);
      const coming = await countCands(cycleId, s.size, s.config, "queued", "generating");
      if (fresh + coming < need) batches += await this.startBatch(cycleId, s.size, s.config);
    }
    return batches;
  }

  // ---------------------------------------------------------------- автоподбор
  autoEnabled(): boolean {
    return ctx().settings.autoPick;
  }

  async toggleAuto(): Promise<boolean> {
    const next = !this.autoEnabled();
    await prisma.mapsSettings.update({ where: { id: 1 }, data: { autoPick: next } });
    ctx().settings.autoPick = next;
    return next;
  }

  // /auto: предстоящие вайпы с запущенной генерацией, где можно подобрать карты.
  async autoTargets(): Promise<[string, string][]> {
    const now = new Date();
    return (await cyclesBy(...MAPS_OPEN_CYCLES)).filter((c) => c.wipeAt > now).map((c) => [c.id, fmt(c.wipeAt)]);
  }

  // Подобрать карты автоматически для вайпа, где генерация уже идёт (карточки заменяются предложением).
  autoStart(cycleId: string): Promise<string> {
    return serial(async () => {
      if (!isOpen(await getCycle(cycleId))) return "Анонс по этому вайпу уже отправлен (или цикл не найден)";
      await updateCycle(cycleId, { autoMode: true, autoMsgId: null });
      return this.autoRerollInner(cycleId);
    });
  }

  autoReroll(cycleId: string): Promise<string> {
    return serial(() => this.autoRerollInner(cycleId));
  }

  // «Перевыбрать автоматически»: неподтверждённые карты отбрасываются, берутся следующие лучшие из пула,
  // при нехватке заказывается новая пачка. Подтверждённые карты не трогаются.
  private async autoRerollInner(cycleId: string): Promise<string> {
    const [cycle, why] = await this.resetChecks(cycleId);
    if (!cycle) return why;
    await updateCycle(cycleId, { autoMode: true });
    for (const s of await slotsFor(cycleId)) if (s.status === "ready" || s.status === "error") await this.releaseSlot(s, msg.noteAutoReplaced());
    const batches = await this.fillPool(cycleId);
    await this.dispatch(cycleId);
    const after = (await getCycle(cycleId))!;
    if (after.autoMsgId && after.autoMsgId > 0 && (await slotsFor(cycleId)).some((s) => s.status === "waiting")) {
      await edit(after.autoMsgId, msg.autoWaiting(), null);
    }
    return "Подбираю заново" + (batches ? `, заказана новая пачка: ${batches}` : "");
  }

  // «Подтвердить все»: выбранные автоподбором карты загружаются на S3, как при подтверждении карточек.
  autoConfirm(cycleId: string): Promise<string> {
    return serial(async () => {
      const cycle = await getCycle(cycleId);
      if (!isOpen(cycle)) return "Анонс по этому вайпу уже отправлен (или цикл не найден)";
      const slots = await slotsFor(cycleId);
      if (slots.some((s) => s.status === "uploading")) return "Идёт загрузка карты, подождите минуту";
      const ready = slots.filter((s) => s.status === "ready");
      if (!ready.length) return "Нет карт для подтверждения";
      await updateCycle(cycleId, { autoMode: false }); // предложение закрыто: дальше обычные карточки
      if (cycle.autoMsgId && cycle.autoMsgId > 0) await edit(cycle.autoMsgId, msg.autoConfirmed(ready.length), null);
      for (const s of slots) if (s.status === "error") await this.refreshCard(s.id); // карточка с ошибкой и кнопками, чтобы можно было поправить
      for (const s of ready) await this.approveInner(s.id);
      return `Загружаю карты: ${ready.length}`;
    });
  }

  // «Выбрать самому»: карточки серверов с уже выбранными картами, дальше обычное редактирование.
  autoManual(cycleId: string): Promise<string> {
    return serial(async () => {
      const cycle = await getCycle(cycleId);
      if (!isOpen(cycle)) return "Анонс по этому вайпу уже отправлен (или цикл не найден)";
      await updateCycle(cycleId, { autoMode: false });
      for (const s of await slotsFor(cycleId)) {
        if (s.status === "ready" && !s.tgMsgId) await this.safe(this.sendCard(s.id), "карточка");
        else if (s.status === "error") await this.safe(this.refreshCard(s.id), "карточка");
      }
      if (cycle.autoMsgId && cycle.autoMsgId > 0) await edit(cycle.autoMsgId, msg.autoManualDone(), null);
      return "Карточки серверов отправлены";
    });
  }

  // Одно сообщение с набором карт, когда все серверы получили карту.
  private async autoProposal(cycleId: string): Promise<void> {
    const cycle = await getCycle(cycleId);
    const slots = await slotsFor(cycleId);
    if (!cycle?.autoMode || slots.some((s) => s.status === "waiting")) return;
    const rows: msg.ProposalRow[] = [];
    const errors: [string, string][] = [];
    for (const s of slots) {
      if (s.status === "error") errors.push([serverTitle(s.serverId), s.error ?? "нет карты"]);
      else if (s.status === "ready") {
        const sc = s.candId ? (await this.groupScores(cycleId, s.size, s.config)).get(s.candId) : undefined;
        rows.push({ title: serverTitle(s.serverId), seed: s.seed, size: s.size, score: sc?.total ?? null, present: sc?.present ?? 0, of: sc?.of ?? 0, missing: sc?.missing ?? [], view: s.viewUrl });
      }
    }
    if (!rows.length && !errors.length) return;
    event("map.auto", `Вайп ${fmt(cycle.wipeAt)}: автоподбор предложил набор карт`, { details: { cycleId, rows: rows.map((r) => ({ server: r.title, seed: r.seed, score: r.score })) } });
    if (!ctx().telegram) return;
    const text = msg.autoProposal(fmt(cycle.wipeAt), rows, errors);
    const kb = msg.kbAutoProposal(cycleId);
    if (cycle.autoMsgId === null) {
      await updateCycle(cycleId, { autoMsgId: -1 }); // защита от второго сообщения при параллельных вызовах
      try {
        await updateCycle(cycleId, { autoMsgId: await notify(text, kb) });
      } catch (err) {
        await updateCycle(cycleId, { autoMsgId: null }); // не отправилось: пусть сработает досылка
        throw err;
      }
    } else if (cycle.autoMsgId > 0) await edit(cycle.autoMsgId, text, kb);
  }

  approve(slotId: number): Promise<string> {
    return serial(() => this.approveInner(slotId));
  }

  private async approveInner(slotId: number): Promise<string> {
    const s = await getSlot(slotId);
    if (!s || s.status !== "ready") return "Уже обработано";
    if (!ctx().storage) return "Не настроен S3: загрузить карту некуда";
    await updateSlot(slotId, { status: "uploading", error: null });
    await this.refreshCard(slotId);
    spawn("загрузка карты", this.upload(slotId));
    return "Загружаю…";
  }

  private async upload(slotId: number): Promise<void> {
    const s = (await getSlot(slotId))!;
    const tmp = join(tmpDir(), `${slotId}.part`);
    let done: Prisma.MapsSlotUpdateInput;
    try {
      const { rustmaps: rm, storage, servers } = ctx();
      const srv = servers.get(s.serverId);
      if (!srv) throw new Error(`Сервера #${s.serverId} больше нет в настройках`);
      if (!rm || !storage) throw new Error("Не настроены RustMaps или S3");
      const [st, mapInfo] = await rm.getMap(s.rmMapId ?? ""); // свежая ссылка на скачивание
      if (st === 401 || st === 403) throw new RustMapsError("RustMaps не принял API-ключ (проверь его в панели, «Подключение»)");
      if (st !== 200 || !mapInfo?.downloadUrl) throw new RustMapsError("RustMaps не отдал downloadUrl (карта не помечена как скачиваемая?)");
      const { size, filename: original } = await rm.download(mapInfo.downloadUrl, tmp);
      if (size < 100_000) throw new RustMapsError(`Файл подозрительно маленький: ${size} байт`);
      // Имя файла сохраняем оригинальное (из ответа RustMaps). Запасной вариант — стандартное имя Rust.
      const filename =
        original ?? (mapInfo.saveVersion !== undefined && mapInfo.saveVersion !== null ? `proceduralmap.${s.size}.${s.seed}.${mapInfo.saveVersion}.map` : `${s.size}_${s.seed}.map`);
      const key = storage.keyFor(srv.folder, filename);
      await storage.upload(tmp, key);
      const cdnUrl = storage.cdnUrl(key);
      const problem = await storage.checkPublic(cdnUrl, size);
      if (problem) throw new Error(`Загружено в S3, но публичная ссылка не прошла проверку: ${problem}`);
      done = { status: "uploaded", s3Key: key, cdnUrl, error: null };
    } catch (err) {
      log.warn(`Загрузка карты сервера ${s.serverId} не удалась`, err);
      done = { status: "ready", error: `Ошибка загрузки: ${errorText(err)}`.slice(0, 300) };
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    await serial(async () => {
      await updateSlot(slotId, done);
      if (done.status === "uploaded") {
        const cycle = (await getCycle(s.cycleId))!;
        event("map.uploaded", `Вайп ${fmt(cycle.wipeAt)}: карта ${serverTitle(s.serverId)} подтверждена и загружена`, { details: { cycleId: s.cycleId, serverId: s.serverId, seed: s.seed, cdnUrl: done.cdnUrl as string } });
        await this.panelReopen(s.cycleId, true);
      }
      await this.safe(this.refreshCard(slotId), "карточка после загрузки");
      await this.maybePromptDiscord(s.cycleId);
    });
  }

  // ---------------------------------------------------------------- ручная загрузка
  // Карты, которые можно заменить своим файлом.
  async manualTargets(): Promise<[number, string][]> {
    const out: [number, string][] = [];
    for (const c of await cyclesBy(...MAPS_OPEN_CYCLES)) {
      for (const s of await slotsFor(c.id)) if (s.status !== "uploading") out.push([s.id, `FR #${s.serverId} · ${fmt(c.wipeAt)}`]);
    }
    return out;
  }

  async manualTargetLabel(slotId: number): Promise<string | null> {
    const s = await getSlot(slotId);
    if (!s) return null;
    const c = await getCycle(s.cycleId);
    if (!isOpen(c) || s.status === "uploading") return null;
    return `${serverTitle(s.serverId)}, вайп ${fmt(c.wipeAt)}`;
  }

  // Кладёт готовый .map на S3 вместо карты сервера. Бросает исключение с текстом для пользователя.
  async manualUpload(slotId: number, src: string, viewUrl: string | null, filename: string | null): Promise<void> {
    const s = await getSlot(slotId);
    const cycle = s ? await getCycle(s.cycleId) : null;
    if (!s || !isOpen(cycle)) throw new Error("Анонс по этому вайпу уже отправлен или карта не найдена");
    if (s.status === "uploading") throw new Error("Эта карта сейчас загружается, подождите минуту");
    const { storage, servers } = ctx();
    if (!storage) throw new Error("Не настроен S3: загрузить карту некуда");
    const srv = servers.get(s.serverId);
    if (!srv) throw new Error(`Сервера #${s.serverId} больше нет в настройках`);
    const size = await fileSize(src);
    if (size < 100_000) throw new Error(`Файл слишком маленький (${size} байт), это не похоже на карту`);
    // Имени нет (не .map или не определилось) — делаем по содержимому.
    const day = cycle.id.slice(-10);
    const name = filename ?? `${day}_manual_${(await sha1(src)).slice(0, 8)}.map`;
    const key = storage.keyFor(srv.folder, name);
    await storage.upload(src, key);
    const cdnUrl = storage.cdnUrl(key);
    const problem = await storage.checkPublic(cdnUrl, size);
    if (problem) throw new Error(`Загружено в S3, но публичная ссылка не прошла проверку: ${problem}`);

    await serial(async () => {
      const cur = (await getSlot(slotId))!;
      if (cur.candId) await updateCand(cur.candId, { status: "rejected", rejectedOrder: await nextOrder() });
      await updateSlot(slotId, {
        status: "uploaded",
        source: "manual",
        attempt: cur.attempt + 1,
        seed: null,
        rmMapId: null,
        candId: null,
        info: Prisma.DbNull,
        viewUrl: viewUrl ?? cdnUrl,
        s3Key: key,
        cdnUrl,
        error: null,
        tgMsgId: null,
        tgPhotoMsgId: null,
      });
      if (cur.tgMsgId) await edit(cur.tgMsgId, msg.noteManualReplaced(), null);
      await dropMessage(cur.tgPhotoMsgId);
      event("map.manual", `Вайп ${fmt(cycle.wipeAt)}: для ${serverTitle(cur.serverId)} загружена своя карта ${name}`, { details: { cycleId: cycle.id, serverId: cur.serverId, cdnUrl } });
      await this.panelReopen(cur.cycleId, true);
      await this.safe(this.refreshCard(slotId), "карточка ручной карты");
      const after = (await getCycle(cur.cycleId))!;
      if (after.status === "generating") await this.maybePromptDiscord(after.id);
      else if (after.status === "scheduled" || after.status === "awaiting_discord") await this.editPrompt(after); // в сообщении с анонсом ссылки обновились
    });
  }

  // Своя карта по прямой ссылке (из панели или Telegram).
  async manualFromUrl(slotId: number, url: string, viewUrl: string | null): Promise<string> {
    const label = await this.manualTargetLabel(slotId);
    if (!label) return "Сюда карту уже нельзя добавить";
    await mkdir(tmpDir(), { recursive: true });
    const path = join(tmpDir(), `manual_${Date.now()}_${slotId}.map`);
    try {
      const { filename } = await downloadUrl(url, path);
      await this.manualUpload(slotId, path, viewUrl, filename);
      return `Карта загружена: ${label}`;
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- Pterodactyl
  panelOn(serverId: number): boolean {
    return !!(ctx().ptero && ctx().servers.get(serverId)?.pteroUuid);
  }

  // Записывает ссылку подтверждённой карты в задачу вайпа (аддон Rust Server Wiper).
  // Задача определяется по дате ближайшего запуска: раз она ближайшая, предыдущий вайп уже прошёл.
  private async syncPanel(slotId: number): Promise<void> {
    const s = await getSlot(slotId);
    if (!s || s.status !== "uploaded" || !s.cdnUrl || !this.panelOn(s.serverId)) return;
    const { ptero, servers, settings } = ctx();
    const cycle = (await getCycle(s.cycleId))!;
    const uuid = servers.get(s.serverId)!.pteroUuid!;
    let synced = false;
    let note = "";
    try {
      const wipe = wipeForDate(await ptero!.listWipes(uuid), cycle.wipeAt);
      const current = wipe?.level ?? "";
      const wantBp = cycle.blueprints;
      const bpText = wantBp ? "включён" : "выключен";
      const dayText = fmt(cycle.wipeAt).split(" ")[1];
      if (!wipe) note = `ждёт: в панели нет задачи на ${dayText} (предыдущий вайп ещё не прошёл?)`;
      else if (current === s.cdnUrl && !!wipe.blueprints === wantBp) [synced, note] = [true, `ссылка и флаг актуальны (Wipe Blueprints ${bpText})`];
      else if (!current.startsWith(settings.cdnBaseUrl)) note = "в задаче вайпа не наша ссылка (пусто или другой источник), не меняю";
      else {
        await ptero!.updateWipe(uuid, wipe, s.cdnUrl, wantBp);
        const after = wipeForDate(await ptero!.listWipes(uuid), cycle.wipeAt);
        if (after && after.level === s.cdnUrl && !!after.blueprints === wantBp) [synced, note] = [true, `ссылка обновлена, Wipe Blueprints ${bpText}`];
        else note = "запись отправлена, но панель показывает другие значения";
      }
    } catch (err) {
      log.warn(`Не удалось обновить задачу вайпа в Pterodactyl (сервер ${s.serverId})`, err);
      note = `не удалось обновить: ${errorText(err)}`.slice(0, 200);
    }
    await updateSlot(slotId, { panelSynced: synced, panelNote: note });
  }

  private async panelSlots(cycleId: string): Promise<MapsSlot[]> {
    return (await slotsFor(cycleId)).filter((s) => this.panelOn(s.serverId));
  }

  // Карты вайпа изменились: запись ссылок нужно подтвердить заново (если уже было done/skipped).
  private async panelReopen(cycleId: string, notifyNow: boolean): Promise<void> {
    const c = await getCycle(cycleId);
    if (!ctx().ptero || !c || c.panelState === "pending") return;
    if (c.panelState === "done" || c.panelState === "skipped" || notifyNow) {
      await updateCycle(cycleId, { panelState: "idle", panelNotifiedAt: notifyNow ? null : new Date() });
    }
  }

  private async panelTick(now: Date): Promise<void> {
    const cycles = await prisma.mapsCycle.findMany({ orderBy: { wipeAt: "desc" }, take: 10 });
    for (const cycle of cycles) {
      if (cycle.wipeAt <= now || cycle.panelState === "done" || cycle.panelState === "skipped") continue;
      if (now.getTime() < cycle.wipeAt.getTime() - panelAskMs()) continue;
      if (!(await this.panelSlots(cycle.id)).length) {
        await updateCycle(cycle.id, { panelState: "skipped" });
        continue;
      }
      if (now.getTime() >= cycle.wipeAt.getTime() - panelAutoMs()) {
        await this.panelApplyInner(cycle.id, true);
        continue;
      }
      const last = cycle.panelNotifiedAt;
      if (!last || now.getTime() - last.getTime() >= panelRemindMs()) await this.panelAsk(cycle);
    }
  }

  private async panelAsk(cycle: MapsCycle): Promise<void> {
    if (!ctx().telegram) {
      // Спросить негде: ссылки запишутся сами за panelAutoMinutes до вайпа или по кнопке в панели.
      await updateCycle(cycle.id, { panelState: "pending", panelNotifiedAt: new Date() });
      return;
    }
    if (cycle.panelMsgId) await edit(cycle.panelMsgId, msg.panelReminderOld(), null); // у прошлого запроса убираем кнопки
    const rows = (await this.panelSlots(cycle.id)).map((s): [string, string | null] => [serverTitle(s.serverId), s.status === "uploaded" ? msg.fname(s.cdnUrl) : null]);
    const text = msg.panelAsk(fmt(cycle.wipeAt), fmt(new Date(cycle.wipeAt.getTime() - panelAutoMs())), cycle.blueprints, rows);
    const messageId = await notify(text, msg.kbPanelAsk(cycle.id));
    await updateCycle(cycle.id, { panelState: "pending", panelMsgId: messageId, panelNotifiedAt: new Date() });
  }

  async globalTargets(): Promise<[string, string][]> {
    const now = new Date();
    const cycles = await prisma.mapsCycle.findMany({ orderBy: { wipeAt: "desc" }, take: 10 });
    return cycles.filter((c) => c.wipeAt > now).map((c) => [c.id, `${fmt(c.wipeAt)}: ${c.blueprints ? "🧹 глобальный" : "обычный"}`]);
  }

  // Переключает признак глобального вайпа (если расписание изменилось). Запись в панель запросится заново.
  toggleGlobal(cycleId: string): Promise<string> {
    return serial(async () => {
      const c = await getCycle(cycleId);
      if (!c || c.wipeAt <= new Date()) return "Этот вайп уже прошёл";
      const next = !c.blueprints;
      await updateCycle(cycleId, { blueprints: next });
      await this.panelReopen(cycleId, true);
      event("cycle.global", `Вайп ${fmt(c.wipeAt)}: ${next ? "отмечен как глобальный" : "отмечен как обычный"}`, { details: { cycleId, blueprints: next } });
      return next ? `Вайп ${fmt(c.wipeAt)}: ГЛОБАЛЬНЫЙ, «Wipe Blueprints» будет включён` : `Вайп ${fmt(c.wipeAt)}: обычный, «Wipe Blueprints» будет выключен`;
    });
  }

  // /panel: ближайшие вайпы, для которых ссылки в Pterodactyl ещё не записаны.
  async panelTargets(): Promise<[string, string][]> {
    if (!ctx().ptero) return [];
    const now = new Date();
    const out: [string, string][] = [];
    for (const c of await prisma.mapsCycle.findMany({ orderBy: { wipeAt: "desc" }, take: 10 })) {
      if (c.wipeAt > now && (c.panelState === "idle" || c.panelState === "pending") && (await this.panelSlots(c.id)).length) out.push([c.id, fmt(c.wipeAt)]);
    }
    return out;
  }

  panelApply(cycleId: string, originMsgId: number | null = null): Promise<string> {
    return serial(() => this.panelApplyInner(cycleId, false, originMsgId));
  }

  // Записывает ссылки подтверждённых карт в задачи вайпа. auto — время вышло, ответа не было.
  private async panelApplyInner(cycleId: string, auto: boolean, originMsgId: number | null = null): Promise<string> {
    const cycle = await getCycle(cycleId);
    if (!cycle || cycle.panelState === "done" || cycle.panelState === "skipped") return "Уже обработано";
    if (!ctx().ptero) return "Pterodactyl не настроен";
    const rows: [string, boolean | null, string][] = [];
    let ok = true;
    for (const slot of await this.panelSlots(cycleId)) {
      const title = serverTitle(slot.serverId);
      if (slot.status !== "uploaded") {
        ok = false;
        rows.push([title, null, "карта не подтверждена, ссылку не менял"]);
        continue;
      }
      await this.syncPanel(slot.id);
      const s = (await getSlot(slot.id))!;
      ok &&= s.panelSynced;
      rows.push([title, s.panelSynced, s.panelNote ?? ""]);
      await this.safe(this.refreshCard(s.id), "карточка после записи в панель");
    }
    await updateCycle(cycleId, { panelState: ok || auto ? "done" : "pending" });
    event("ptero.apply", `Вайп ${fmt(cycle.wipeAt)}: ссылки в Pterodactyl ${ok ? "записаны" : "записаны не все"}${auto ? " (автоматически)" : ""}`, {
      level: ok ? "INFO" : "WARN",
      details: { cycleId, rows: rows.map(([server, synced, note]) => ({ server, synced, note })) },
    });
    const text = msg.panelResult(auto, fmt(cycle.wipeAt), rows, ok);
    if (cycle.panelMsgId) await edit(cycle.panelMsgId, text, null);
    if (originMsgId && originMsgId !== cycle.panelMsgId) await edit(originMsgId, text, null); // кнопка нажата в другом сообщении (/panel)
    if (auto || !(cycle.panelMsgId || originMsgId)) await notify(text);
    return ok ? "Ссылки обновлены" : "Есть проблемы, подробности в карточках";
  }

  panelSkip(cycleId: string): Promise<string> {
    return serial(async () => {
      const cycle = await getCycle(cycleId);
      if (!cycle || cycle.panelState === "done" || cycle.panelState === "skipped") return "Уже обработано";
      await updateCycle(cycleId, { panelState: "skipped" });
      if (cycle.panelMsgId) await edit(cycle.panelMsgId, msg.panelSkipped(), null);
      return "Хорошо, не обновляю";
    });
  }

  // Что сейчас записано в задачах вайпа в Pterodactyl, по серверам.
  async panelStatus(): Promise<{ title: string; error: string | null; tasks: { run: string; blueprints: boolean; map: string }[] }[] | null> {
    const { ptero, servers } = ctx();
    const withUuid = [...servers.values()].filter((s) => s.pteroUuid);
    if (!ptero || !withUuid.length) return null;
    const out = [];
    for (const srv of withUuid) {
      try {
        const tasks = (await ptero.listWipes(srv.pteroUuid!)).map((w) => {
          const run = nextRun(w);
          return { run: run ? fmt(run) : "?", blueprints: !!w.blueprints, map: msg.fname(w.level) || "карта не задана" };
        });
        out.push({ title: srv.title, error: null, tasks });
      } catch (err) {
        out.push({ title: srv.title, error: errorText(err), tasks: [] });
      }
    }
    return out;
  }

  async panelText(): Promise<string> {
    const status = await this.panelStatus();
    if (!status) return msg.panelUnconfigured();
    return msg.panelStatus(status.map((s) => [s.title, s.error, s.tasks.map((t): [string, boolean, string] => [t.run, t.blueprints, t.map])]));
  }

  // ---------------------------------------------------------------- Discord
  private async urls(cycleId: string) {
    return Object.fromEntries((await slotsFor(cycleId)).map((s) => [s.serverId, { view: s.viewUrl, download: s.cdnUrl }]));
  }

  private async promptText(cycle: MapsCycle, extra = ""): Promise<string> {
    const rows = (await slotsFor(cycle.id)).map((s): [string, boolean, string] => [serverTitle(s.serverId), s.source === "manual", s.cdnUrl ?? ""]);
    return msg.discordPrompt(fmt(cycle.wipeAt), rows, cycle.status, fmt(cycle.sendAt), cycle.sendAt > new Date(), extra);
  }

  private promptMarkup(cycle: MapsCycle): InlineKeyboard | null {
    return cycle.status === "scheduled" || cycle.status === "awaiting_discord" ? msg.kbDiscordPrompt(cycle.id) : null;
  }

  private async editPrompt(cycle: MapsCycle, extra = ""): Promise<void> {
    if (cycle.promptMsgId) await edit(cycle.promptMsgId, await this.promptText(cycle, extra), this.promptMarkup(cycle));
  }

  private async postPrompt(cycleId: string): Promise<void> {
    const cycle = (await getCycle(cycleId))!;
    const id = await notify(await this.promptText(cycle), this.promptMarkup(cycle));
    if (id) await updateCycle(cycleId, { promptMsgId: id });
  }

  // Все карты подтверждены: ставим анонс на авто-отправку в sendAt (или шлём сразу, если время прошло).
  private async maybePromptDiscord(cycleId: string): Promise<void> {
    const cycle = await getCycle(cycleId);
    if (cycle?.status !== "generating") return;
    if ((await slotsFor(cycleId)).some((s) => s.status !== "uploaded")) return;
    await updateCycle(cycleId, { status: "scheduled" });
    event("cycle.ready", `Вайп ${fmt(cycle.wipeAt)}: все карты подтверждены, анонс уйдёт ${fmt(cycle.sendAt)}`, { details: { cycleId } });
    await this.safe(this.postPrompt(cycleId), "вопрос про анонс");
    if (cycle.sendAt <= new Date()) await this.sendDiscordInner(cycleId);
  }

  // Вернуть вопрос про отправку (в ручном режиме, без автоотправки). Без cycleId — последний подходящий вайп.
  repromptDiscord(cycleId?: string): Promise<string> {
    return serial(async () => {
      const cycles = await cyclesBy("skipped", "awaiting_discord", "scheduled");
      const target = cycleId ? cycles.find((c) => c.id === cycleId) : cycles.at(-1);
      if (!target) return "Нечего отправлять";
      await updateCycle(target.id, { status: "awaiting_discord" });
      await this.postPrompt(target.id);
      return "Анонс ждёт отправки вручную";
    });
  }

  skipDiscord(cycleId: string): Promise<string> {
    return serial(async () => {
      const cycle = await getCycle(cycleId);
      if (!cycle || (cycle.status !== "awaiting_discord" && cycle.status !== "scheduled")) return "Уже обработано";
      await updateCycle(cycleId, { status: "skipped" });
      event("discord.skipped", `Вайп ${fmt(cycle.wipeAt)}: анонс в Discord отключён`, { details: { cycleId } });
      await this.editPrompt((await getCycle(cycleId))!, msg.discordSkipped());
      return "Отменено";
    });
  }

  webhookHint(): string {
    const w = ctx().webhook;
    return w ? mapsSecretHint("discordWebhook", w) : "не задан";
  }

  async resendTargets(): Promise<[string, string][]> {
    const sent = (await cyclesBy("sent")).slice(-5).reverse();
    return sent.map((c) => [c.id, fmt(c.wipeAt)]);
  }

  async resendSummary(cycleId: string): Promise<string> {
    const c = await getCycle(cycleId);
    return c ? msg.resendAsk(fmt(c.wipeAt), this.webhookHint()) : "Цикл не найден";
  }

  // Повторная отправка уже отправленного анонса (например, после смены вебхука).
  resendDiscord(cycleId: string): Promise<[boolean, string]> {
    return serial(async (): Promise<[boolean, string]> => {
      const cycle = await getCycle(cycleId);
      if (cycle?.status !== "sent") return [false, "Повторно можно отправить только уже отправленный анонс"];
      try {
        await this.postAnnouncement(cycle);
      } catch (err) {
        log.warn("Повторная отправка анонса не удалась", err);
        return [false, errorText(err)];
      }
      event("discord.resent", `Вайп ${fmt(cycle.wipeAt)}: анонс отправлен в Discord повторно`, { details: { cycleId } });
      return [true, this.webhookHint()];
    });
  }

  private async postAnnouncement(cycle: MapsCycle): Promise<void> {
    const webhook = ctx().webhook;
    if (!webhook) throw new Error("Вебхук Discord не задан (панель → «Подключение»)");
    const rule = ctx().rules.find((r) => r.key === cycle.ruleKey);
    if (!rule) throw new Error(`Правила «${cycle.ruleKey}» больше нет: шаблон анонса взять неоткуда`);
    await sendWebhook(webhook, renderMapsTemplate(rule.template, await this.urls(cycle.id)));
  }

  sendDiscord(cycleId: string): Promise<string> {
    return serial(() => this.sendDiscordInner(cycleId));
  }

  private async sendDiscordInner(cycleId: string): Promise<string> {
    const cycle = await getCycle(cycleId);
    if (!cycle || (cycle.status !== "awaiting_discord" && cycle.status !== "scheduled")) return "Уже обработано";
    await updateCycle(cycleId, { status: "sending" });
    try {
      await this.postAnnouncement(cycle);
    } catch (err) {
      log.warn(`Анонс вайпа ${fmt(cycle.wipeAt)} не отправился в Discord`, err);
      await updateCycle(cycleId, { status: "awaiting_discord" });
      await this.editPrompt((await getCycle(cycleId))!, msg.discordFailed(errorText(err)));
      if (!(await getCycle(cycleId))!.promptMsgId) await notify(msg.discordFailed(errorText(err)));
      return "Ошибка отправки";
    }
    await updateCycle(cycleId, { status: "sent" });
    event("discord.sent", `Вайп ${fmt(cycle.wipeAt)}: анонс отправлен в Discord`, { details: { cycleId } });
    await this.editPrompt((await getCycle(cycleId))!, msg.discordSent());
    return "Отправлено";
  }

  // ---------------------------------------------------------------- справка
  async statusText(): Promise<string> {
    const cycles: msg.CycleView[] = [];
    for (const c of await prisma.mapsCycle.findMany({ orderBy: { wipeAt: "desc" }, take: 3 })) {
      const pool: Record<string, number> = {};
      for (const k of await prisma.mapsCandidate.findMany({ where: { cycleId: c.id }, select: { size: true, status: true } })) {
        pool[`${k.size}:${k.status}`] = (pool[`${k.size}:${k.status}`] ?? 0) + 1;
      }
      cycles.push({
        wipe: fmt(c.wipeAt),
        staging: c.staging,
        blueprints: c.blueprints,
        id: c.id,
        status: c.status,
        pool,
        slots: (await slotsFor(c.id)).map((s) => [serverTitle(s.serverId), s.source === "manual", s.status, s.attempt]),
      });
    }
    return msg.statusView(cycles, ctx().missing);
  }

  nextText(): string {
    const { rules, settings, ptero } = ctx();
    const items = upcomingWipes(rules, settings.timezone)
      .slice(0, 4)
      .map((w) => ({
        wipe: fmt(w.wipeAt),
        servers: w.rule.serverIds,
        staging: isStagingWipe(w.wipeAt, settings.timezone),
        blueprints: isBlueprintWipe(w.rule, w.wipeAt, settings.timezone),
        gen: fmt(new Date(w.wipeAt.getTime() - (settings.sendLeadHours + settings.genLeadHours) * HOUR_MS)),
        send: fmt(new Date(w.wipeAt.getTime() - settings.sendLeadHours * HOUR_MS)),
        panel: ptero ? fmt(new Date(w.wipeAt.getTime() - panelAskMs())) : null,
      }));
    return msg.nextView(items);
  }
}

export const service = new MapsService();
