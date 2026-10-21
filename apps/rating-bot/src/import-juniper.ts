// Переносит опыт из рейтинга JuniperBot (файл из скрипта выгрузки, см. README).
//   pnpm -F rating-bot import-juniper <файл.json>            — только предпросмотр, ничего не меняет
//   pnpm -F rating-bot import-juniper <файл.json> --apply    — записать
//   --factor 1.5  — сколько наших сообщений считать за одно начисление JuniperBot (по умолчанию 1)
//
// Опыт пересчитывается «как если бы человек писал у нас»: опыт JuniperBot делится на 19,5
// (он даёт 15–24 за сообщение и не чаще раза в минуту) — это число засчитанных сообщений;
// затем эти сообщения проходят через наши ранги со средним начислением каждого ранга.
// Опыт за голос у JuniperBot на этом сервере не начислялся, поэтому весь его опыт — за сообщения;
// время в голосе переносится отдельно в voiceSeconds.
//
// Повторный запуск безопасен: опыт ставится, только если пересчитанный больше текущего.
// Скрап за сообщения и награды за ранги не начисляются; роли бот раздаст сам в фоне.
import { existsSync, readFileSync } from "node:fs";
import { getRatingSettings, prisma, rankForXp, simulateMessages } from "@flamebot/core";

const JUNIPER_EXP_PER_MESSAGE = 19.5;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const factorIdx = args.indexOf("--factor");
const factor = factorIdx >= 0 ? Number(args[factorIdx + 1]) : 1;
const file = args.find((a, i) => !a.startsWith("--") && !(factorIdx >= 0 && i === factorIdx + 1));

if (!file || !existsSync(file) || !Number.isFinite(factor) || factor <= 0 || factor > 100) {
  console.error("Использование: pnpm -F rating-bot import-juniper /путь/к/juniper-ranking-<сервер>.json [--factor 1] [--apply]");
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

const [settings, ranks, existing] = await Promise.all([
  getRatingSettings(prisma),
  prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
  prisma.member.findMany({ where: { id: { in: [...byId.keys()] } }, select: { id: true, xp: true, messageCount: true, voiceSeconds: true, displayName: true } }),
]);
const current = new Map(existing.map((m) => [m.id, m]));

interface Plan {
  id: string;
  name: string;
  juniperExp: number;
  messages: number;
  xp: number; // пересчитанный
  before: number | null; // текущий у нас, null — участника ещё нет
  after: number;
  voiceSeconds: number;
  changes: boolean;
}

const plans: Plan[] = [];
for (const m of byId.values()) {
  const messages = Math.round((m.totalExp / JUNIPER_EXP_PER_MESSAGE) * factor);
  const xp = simulateMessages(messages, settings, ranks).xp;
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
console.log(`Пересчёт: опыт JuniperBot / ${JUNIPER_EXP_PER_MESSAGE} × ${factor} = сообщений; сообщения проходят через наши ранги (${ranks.length}) со средней ставкой.`);
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
    сообщений: p.messages,
    "сейчас у нас": p.before === null ? "—" : fmt(p.before),
    станет: fmt(p.after),
    ранг: rankName(p.after),
    "в голосе, ч": Math.round(p.voiceSeconds / 360) / 10,
  })),
);

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
      if (!have) {
        created++;
        // Есть ли человек на сервере, проверит бот при пересчёте ролей и снимет отметку, если нет.
        return prisma.member.create({
          data: { id: p.id, username: p.name, displayName: p.name, xp: p.after, messageCount: p.messages, voiceSeconds: p.voiceSeconds, needsRoleSync: true },
        });
      }
      updated++;
      return prisma.member.update({
        where: { id: p.id },
        data: {
          xp: p.after,
          messageCount: Math.max(have.messageCount, p.messages),
          voiceSeconds: Math.max(have.voiceSeconds, p.voiceSeconds),
          // Пересчёт ролей без наград за ранги: так бот делает при любой ручной правке опыта.
          ...(p.after > have.xp ? { needsRoleSync: true } : {}),
        },
      });
    }),
  );
}
await prisma.auditLog.create({
  data: {
    module: "rating",
    actorId: "import",
    actorName: "Импорт из JuniperBot",
    action: "member.import",
    target: `${todo.length} участников`,
    details: { file: raw.exportedAt ?? null, guildId: raw.guildId ?? null, factor, created, updated, unchanged: plans.length - todo.length },
  },
});
console.log(`\nГотово: создано ${created}, обновлено ${updated}, без изменений ${plans.length - todo.length}. Роли бот раздаст в фоне, по 25 человек за проход.`);
await prisma.$disconnect();
