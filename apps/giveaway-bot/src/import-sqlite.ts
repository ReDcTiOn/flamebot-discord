// Переносит розыгрыши, участников и промокоды из базы прежнего бота на Python (data/giveaways.db).
// Запуск: pnpm -F giveaway-bot import-sqlite <путь к giveaways.db>
// Номера розыгрышей сохраняются, новые продолжат нумерацию. Запускать один раз, пока таблица пуста.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prisma, type GiveawayStatus } from "@flamebot/core";

const path = process.argv[2];
if (!path || !existsSync(path)) {
  console.error("Укажи путь к базе прежнего бота: pnpm -F giveaway-bot import-sqlite /путь/к/giveaways.db");
  process.exit(1);
}

const db = new DatabaseSync(resolve(path), { readOnly: true });

// Discord ID в SQLite лежат 64-битными числами и в обычный number JavaScript не помещаются.
function rows<T>(sql: string): T[] {
  const st = db.prepare(sql);
  st.setReadBigInts(true);
  return st.all() as T[];
}
const id = (v: bigint | number | null) => (v === null ? null : String(v));
const at = (v: bigint | number) => new Date(Number(v) * 1000);
// Победители лежат JSON-массивом чисел. JSON.parse округлил бы ID, поэтому достаём цифры как текст.
const ids = (json: string) => json.match(/\d+/g) ?? [];

const STATUS: Record<string, GiveawayStatus> = { active: "ACTIVE", ended: "ENDED", cancelled: "CANCELLED" };

interface OldGiveaway {
  id: bigint;
  channel_id: bigint;
  message_id: bigint | null;
  host_id: bigint;
  prize: string;
  description: string | null;
  winners_count: bigint;
  ends_at: bigint;
  boosters_only: bigint;
  status: string;
  winners: string;
  created_at: bigint;
}

const giveaways = rows<OldGiveaway>("SELECT * FROM giveaways ORDER BY id");
const entries = rows<{ giveaway_id: bigint; user_id: bigint; joined_at: bigint }>("SELECT * FROM entries");
const promos = rows<{ id: bigint; giveaway_id: bigint; code: string; user_id: bigint | null; dm_sent: bigint }>("SELECT * FROM promo_codes ORDER BY id");

if ((await prisma.giveaway.count()) > 0) {
  console.error("В новой базе уже есть розыгрыши. Импорт делается один раз в пустую таблицу, поэтому остановлен.");
  process.exit(1);
}

await prisma.$transaction(async (tx) => {
  await tx.giveaway.createMany({
    data: giveaways.map((g) => ({
      id: Number(g.id),
      channelId: id(g.channel_id)!,
      messageId: id(g.message_id),
      hostId: id(g.host_id)!,
      prize: g.prize,
      description: g.description,
      winnersCount: Number(g.winners_count),
      endsAt: at(g.ends_at),
      boostersOnly: g.boosters_only !== 0n,
      status: STATUS[g.status] ?? "CANCELLED",
      winners: ids(g.winners),
      createdAt: at(g.created_at),
    })),
  });
  await tx.giveawayEntry.createMany({
    data: entries.map((e) => ({ giveawayId: Number(e.giveaway_id), userId: id(e.user_id)!, joinedAt: at(e.joined_at) })),
  });
  await tx.giveawayPromoCode.createMany({
    data: promos.map((p) => ({ id: Number(p.id), giveawayId: Number(p.giveaway_id), code: p.code, userId: id(p.user_id), dmSent: p.dm_sent !== 0n })),
  });
  // Номера заданы вручную, поэтому счётчики продолжаем с наибольшего номера.
  await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"Giveaway"', 'id'), GREATEST((SELECT MAX(id) FROM "Giveaway"), 1))`);
  await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"GiveawayPromoCode"', 'id'), GREATEST((SELECT MAX(id) FROM "GiveawayPromoCode"), 1))`);
});

const active = giveaways.filter((g) => g.status === "active").length;
console.log(`Перенесено: розыгрышей ${giveaways.length} (активных ${active}), участий ${entries.length}, промокодов ${promos.length}.`);
if (active > 0) console.log("Активные розыгрыши продолжит новый бот. Прежнего бота нужно остановить, а новому дать тот же токен.");
await prisma.$disconnect();
