// Переносит опыт из рейтинга JuniperBot (файл из скрипта выгрузки, см. README).
//   pnpm -F rating-bot import-juniper <файл.json>            — только предпросмотр, ничего не меняет
//   pnpm -F rating-bot import-juniper <файл.json> --apply    — записать
//
// Рейтинг у нас устроен как в JuniperBot (те же уровни и начисление), поэтому опыт переносится один в один.
// Число засчитанных сообщений оценивается как опыт / 19,5 (JuniperBot даёт 15–24 за сообщение).
// Время в голосе переносится в voiceSeconds.
//
// Повторный запуск безопасен: опыт ставится, только если он больше текущего.
// Роли в Discord не трогаются: они у игроков уже есть. Ранг записывается в базу сразу,
// награды за него считаются выданными, скрап за сообщения не начисляется.
// Потом бот проверяет каждого из файла: ушедших отмечает, остальным обновляет имя и подтягивает
// опыт до порога самой высокой роли ранга, которая у человека уже есть, — все остаются при своих ролях.
import { existsSync, readFileSync } from "node:fs";
import { levelFromExp, prisma, rankForXp } from "@flamebot/core";

const JUNIPER_EXP_PER_MESSAGE = 19.5;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const file = args.find((a) => !a.startsWith("--"));

if (!file || !existsSync(file)) {
  console.error("Использование: pnpm -F rating-bot import-juniper /путь/к/juniper-ranking-<сервер>.json [--apply]");
  process.exit(1);
}

interface JuniperMember {
  id: string;
  name: string | null;
  nick: string | null;
  totalExp: number;
  level: number;
  voiceActivity: number; // миллисекунды
}

const raw = JSON.parse(readFileSync(file, "utf8")) as { source?: string; guildId?: string; exportedAt?: string; members?: JuniperMember[] };
if (raw.source !== "juniper.bot" || !Array.isArray(raw.members)) {
  console.error("Это не файл выгрузки JuniperBot: нет поля source = juniper.bot или списка members.");
  process.exit(1);
}

// Пока скрипт листал страницы, таблица сдвигалась, поэтому один человек мог попасть дважды.
const byId = new Map<string, JuniperMember>();
for (const m of raw.members) {
  if (!/^\d{17,20}$/.test(String(m.id))) continue;
  const prev = byId.get(m.id);
  if (!prev || m.totalExp > prev.totalExp || m.voiceActivity > prev.voiceActivity) {
    byId.set(m.id, { ...m, totalExp: Math.max(m.totalExp, prev?.totalExp ?? 0), voiceActivity: Math.max(m.voiceActivity, prev?.voiceActivity ?? 0) });
  }
}

const [ranks, existing] = await Promise.all([
  prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
  prisma.member.findMany({
    where: { id: { in: [...byId.keys()] } },
    select: { id: true, xp: true, messageCount: true, voiceSeconds: true, rewardedUpToXp: true, displayName: true },
  }),
]);
const current = new Map(existing.map((m) => [m.id, m]));

interface Plan {
  id: string;
  name: string;
  juniperExp: number;
  messages: number;
  xp: number; // опыт JuniperBot
  before: number | null; // текущий у нас, null — участника ещё нет
  after: number;
  voiceSeconds: number;
  changes: boolean;
}

const plans: Plan[] = [];
for (const m of byId.values()) {
  const messages = Math.round(m.totalExp / JUNIPER_EXP_PER_MESSAGE);
  const xp = m.totalExp;
  const voiceSeconds = Math.round(m.voiceActivity / 1000);
  const have = current.get(m.id);
  const after = Math.max(have?.xp ?? 0, xp);
  const changes = !have || xp > have.xp || voiceSeconds > have.voiceSeconds || messages > have.messageCount;
  if (!have && messages === 0 && voiceSeconds === 0) continue; // пустые записи не создаём
  plans.push({ id: m.id, name: (m.nick || m.name || m.id).slice(0, 64), juniperExp: m.totalExp, messages, xp, before: have?.xp ?? null, after, voiceSeconds, changes });
}
plans.sort((a, b) => b.after - a.after);

// ------------------------------------------------------------------ предпросмотр
const rankName = (xp: number) => rankForXp(ranks, xp)?.name ?? "без ранга";
const fmt = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });

console.log(`Файл: сервер ${raw.guildId ?? "?"}, выгружен ${raw.exportedAt ?? "?"}. Записей ${raw.members.length}, разных участников ${byId.size}.`);
console.log(`Опыт переносится как есть: уровни и начисление у нас те же, что в JuniperBot. Рангов: ${ranks.length}.`);
console.log(`Уже есть у нас: ${existing.length}, новых: ${plans.filter((p) => p.before === null).length}, изменится: ${plans.filter((p) => p.changes).length}.`);

const dist = new Map<string, { before: number; after: number }>();
for (const p of plans) {
  const b = rankName(p.before ?? 0);
  const a = rankName(p.after);
  dist.set(b, { before: (dist.get(b)?.before ?? 0) + 1, after: dist.get(b)?.after ?? 0 });
  dist.set(a, { before: dist.get(a)?.before ?? 0, after: (dist.get(a)?.after ?? 0) + 1 });
}
console.log("\nРанги участников из файла: сейчас → после импорта");
for (const name of ["без ранга", ...ranks.map((r) => r.name)]) {
  const d = dist.get(name);
  if (d) console.log(`  ${name.padEnd(16)} ${String(d.before).padStart(5)} → ${String(d.after).padStart(5)}`);
}

console.log("\nПервые 15 после импорта:");
console.table(
  plans.slice(0, 15).map((p) => ({
    участник: p.name,
    "опыт Juniper": p.juniperExp,
    "сейчас у нас": p.before === null ? "—" : fmt(p.before),
    станет: fmt(p.after),
    уровень: levelFromExp(p.after),
    ранг: rankName(p.after),
    "в голосе, ч": Math.round(p.voiceSeconds / 360) / 10,
  })),
);

console.log("\nДо порога ролей ранга опыт поднимет бот после записи: роли видит только он, в предпросмотре этого нет.");

if (!apply) {
  console.log("\nЭто предпросмотр, база не менялась. Чтобы записать, запусти ту же команду с --apply.");
  await prisma.$disconnect();
  process.exit(0);
}

// ------------------------------------------------------------------ запись
let created = 0;
let updated = 0;
const todo = plans.filter((p) => p.changes);
for (let i = 0; i < todo.length; i += 200) {
  const chunk = todo.slice(i, i + 200);
  await prisma.$transaction(
    chunk.map((p) => {
      const have = current.get(p.id);
      const rank = rankForXp(ranks, p.after);
      // Ранг — сразу в базу, без похода в Discord; награды за ранги до него считаем выданными.
      const rankData = { rankId: rank?.id ?? null, rewardedUpToXp: Math.max(have?.rewardedUpToXp ?? 0, rank?.minXp ?? 0) };
      if (!have) {
        created++;
        // В топе человек появится, когда бот убедится, что он на сервере.
        return prisma.member.create({
          data: {
            id: p.id,
            username: p.name,
            displayName: p.name,
            xp: p.after,
            messageCount: p.messages,
            voiceSeconds: p.voiceSeconds,
            ...rankData,
            inGuild: false,
            needsMemberCheck: true,
          },
        });
      }
      updated++;
      return prisma.member.update({
        where: { id: p.id },
        data: {
          xp: p.after,
          messageCount: Math.max(have.messageCount, p.messages),
          voiceSeconds: Math.max(have.voiceSeconds, p.voiceSeconds),
          ...(p.after > have.xp ? rankData : {}),
        },
      });
    }),
  );
}
// Всех из файла бот проверит: кто на сервере, и подтянет опыт до роли ранга, которая у человека уже есть.
const checked = await prisma.member.updateMany({ where: { id: { in: plans.map((p) => p.id) } }, data: { needsMemberCheck: true } });
await prisma.auditLog.create({
  data: {
    module: "rating",
    actorId: "import",
    actorName: "Импорт из JuniperBot",
    action: "member.import",
    target: `${todo.length} участников`,
    details: { file: raw.exportedAt ?? null, guildId: raw.guildId ?? null, created, updated, unchanged: plans.length - todo.length },
  },
});
console.log(`\nГотово: создано ${created}, обновлено ${updated}, без изменений ${plans.length - todo.length}. Роли не менялись.`);
console.log(
  `Бот проверит ${checked.count} участников в фоне, по 50 за 30 секунд (около ${Math.ceil(checked.count / 100)} мин): ушедших отметит, ` +
    "остальным подтянет опыт до порога роли ранга, которая у них уже есть, и они появятся в топе.",
);
await prisma.$disconnect();
