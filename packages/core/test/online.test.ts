import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDowntime,
  onlineDownMessage,
  onlineTelegramSchema,
  onlineTelegramText,
  onlineUpMessage,
  parseTelegramChats,
  planOnlineAlerts,
  serversCount,
  telegramTokenHint,
  telegramTokenSchema,
  type AlertMemory,
  type AlertServer,
} from "../src/online.js";

describe("уведомления онлайна в Telegram", () => {
  it("длительность простоя", () => {
    assert.equal(formatDowntime(45_000), "45 с");
    assert.equal(formatDowntime(3 * 60_000 + 12_000), "3 мин 12 с");
    assert.equal(formatDowntime(3 * 60_000), "3 мин");
    assert.equal(formatDowntime(12 * 60_000 + 20_000), "12 мин");
    assert.equal(formatDowntime(2 * 3_600_000), "2 ч");
    assert.equal(formatDowntime(2 * 3_600_000 + 5 * 60_000), "2 ч 5 мин");
    assert.equal(formatDowntime(3 * 86_400_000 + 4 * 3_600_000), "3 д 4 ч");
    assert.equal(formatDowntime(-5), "0 с");
  });

  it("подстановки в тексте", () => {
    assert.equal(
      onlineTelegramText("🟢 {server}: {players}/{max}, лежал {downtime}", { server: "FR #1", downtime: "5 мин", players: 10, max: 200 }),
      "🟢 FR #1: 10/200, лежал 5 мин",
    );
    assert.equal(onlineTelegramText("🔴 {server} {downtime}", { server: "FR #2" }), "🔴 FR #2 ");
  });

  it("список чатов", () => {
    assert.deepEqual(parseTelegramChats("123, -100456\n@flame_news  123"), ["123", "-100456", "@flame_news"]);
    const base = {
      notifyOffline: true,
      notifyOnline: true,
      delaySec: 60,
      offlineText: "a",
      onlineText: "b",
      groupOfflineText: "c",
      groupOnlineText: "d",
      groupOnlineLine: "e",
      groupWaitingText: "f",
    };
    assert.ok(onlineTelegramSchema.safeParse({ ...base, chatIds: ["123", "-100456", "@flame_news"] }).success);
    assert.ok(!onlineTelegramSchema.safeParse({ ...base, chatIds: ["abc"] }).success);
    assert.ok(!onlineTelegramSchema.safeParse({ ...base, chatIds: [], delaySec: 4000 }).success);
  });

  it("токен и подсказка без секрета", () => {
    // Выдуманный токен собирается из частей, чтобы сканер секретов GitHub не принимал его за настоящий.
    const token = ["123456789", `${"x".repeat(31)}saw0`].join(":");
    assert.ok(telegramTokenSchema.safeParse(token).success);
    assert.ok(!telegramTokenSchema.safeParse("123:short").success);
    const hint = telegramTokenHint(token);
    assert.equal(hint, "бот 123456789, …saw0");
    assert.ok(!hint.includes("xxxx"));
  });
});

// Сервер в модели: что видит бот и что хранится в базе. Применяем план, как это делает бот.
type Sim = AlertServer;
function sim(ids: number[]): { servers: Sim[]; memory: AlertMemory; tick: (now: number) => ReturnType<typeof planOnlineAlerts> } {
  const servers: Sim[] = ids.map((id) => ({ id, online: true, offlineSince: 0, alertState: "ONLINE", downSince: null, downNotifiedAt: null }));
  const memory: AlertMemory = { downAt: new Map(), upAt: new Map() };
  const tick = (now: number) => {
    const plan = planOnlineAlerts(servers, memory, now, 5_000);
    for (const [id, u] of plan.updates) Object.assign(servers.find((s) => s.id === id)!, u);
    return plan;
  };
  return { servers, memory, tick };
}
const set = (servers: Sim[], id: number, online: boolean, at: number) => {
  const s = servers.find((x) => x.id === id)!;
  s.online = online;
  if (!online) s.offlineSince = at;
};

describe("сводные уведомления онлайна", () => {
  it("массовый рестарт: все упавшие вместе — одним сообщением", () => {
    const { servers, tick } = sim([1, 2, 3, 4]);
    for (const id of [1, 2, 3]) set(servers, id, false, 0);
    set(servers, 4, false, 8_000); // упал чуть позже
    assert.deepEqual(tick(3_000).down, []); // ещё не прошло 5 с
    assert.deepEqual(tick(6_000).down, []); // ждём остальных 15 с
    assert.deepEqual(tick(15_000).down, []);
    assert.deepEqual(tick(21_000).down, [1, 2, 3, 4]);
    assert.deepEqual(tick(24_000).down, []); // второй раз не шлём
  });

  it("включения ждут остальных из того же рестарта", () => {
    const { servers, tick } = sim([1, 2, 3]);
    for (const id of [1, 2, 3]) set(servers, id, false, 0);
    tick(6_000);
    tick(21_000);
    set(servers, 1, true, 0);
    set(servers, 2, true, 0);
    assert.deepEqual(tick(200_000).up, []);
    assert.deepEqual(tick(260_000).up, []); // третий ещё грузится, ждём
    set(servers, 3, true, 0);
    // Поднялся последний из рестарта — ждать больше некого, шлём сразу.
    const plan = tick(263_000);
    assert.deepEqual(plan.up, [1, 2, 3]);
    assert.deepEqual(plan.waiting, []);
  });

  it("кто не поднялся за 2 минуты — в «пока выключены», потом отдельно", () => {
    const { servers, tick } = sim([1, 2]);
    set(servers, 1, false, 0);
    set(servers, 2, false, 0);
    tick(6_000);
    tick(21_000);
    set(servers, 1, true, 0);
    tick(100_000);
    const first = tick(220_000);
    assert.deepEqual(first.up, [1]);
    assert.deepEqual(first.waiting, [2]);
    set(servers, 2, true, 0);
    tick(300_000);
    const second = tick(305_000);
    assert.deepEqual(second.up, [2]);
    assert.deepEqual(second.waiting, []);
  });

  it("сервер поднялся, пока ждали остальных: уведомление не теряется", () => {
    const { servers, tick } = sim([1]);
    set(servers, 1, false, 0);
    tick(6_000); // выключен, ждём остальных
    set(servers, 1, true, 0);
    assert.deepEqual(tick(10_000).down, []);
    const plan = tick(15_000);
    assert.deepEqual(plan.up, [1]); // придёт «снова работает» с временем простоя
    assert.equal(servers[0]!.alertState, "ONLINE");
  });

  it("новый сервер, которого не видели работающим, молчит", () => {
    const { servers, tick } = sim([1]);
    Object.assign(servers[0]!, { online: false, offlineSince: 0, alertState: null });
    const a = tick(10_000);
    assert.deepEqual([a.down, a.up], [[], []]);
    servers[0]!.online = true;
    const b = tick(20_000);
    assert.deepEqual([b.down, b.up], [[], []]);
    assert.equal(servers[0]!.alertState, "ONLINE");
  });

  it("тексты сообщений", () => {
    const t = {
      offlineText: "🔴 Сервер {server} выключился",
      onlineText: "🟢 Сервер {server} снова работает. Был выключен {downtime}",
      groupOfflineText: "🔴 Выключились {count}",
      groupOnlineText: "🟢 Снова работают {count}",
      groupOnlineLine: "• {server} – {downtime} · {players}/{max}",
      groupWaitingText: "⏳ Пока выключены: {servers}",
    };
    assert.equal(serversCount(4), "4 сервера");
    assert.equal(serversCount(5), "5 серверов");
    assert.equal(serversCount(21), "21 сервер");
    assert.equal(onlineDownMessage(t, ["#1"]), "🔴 Сервер #1 выключился");
    assert.equal(onlineDownMessage(t, ["#1", "#2"]), "🔴 Выключились 2 сервера\n• #1\n• #2");
    const up = [
      { server: "#1", downtime: "3 мин 12 с", players: 18, max: 200 },
      { server: "#2", downtime: "3 мин 40 с", players: 9, max: 150 },
    ];
    assert.equal(onlineUpMessage(t, up.slice(0, 1), []), "🟢 Сервер #1 снова работает. Был выключен 3 мин 12 с");
    assert.equal(
      onlineUpMessage(t, up, ["#5"]),
      "🟢 Снова работают 2 сервера\n• #1 – 3 мин 12 с · 18/200\n• #2 – 3 мин 40 с · 9/150\n\n⏳ Пока выключены: #5",
    );
  });
});
