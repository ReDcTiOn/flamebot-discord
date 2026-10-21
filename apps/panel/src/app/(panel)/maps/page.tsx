import Link from "next/link";
import {
  MAPS_CYCLE_STATUS,
  MAPS_OPEN_CYCLES,
  MAPS_SECRETS,
  isBlueprintWipe,
  isStagingWipe,
  mapsRuleProblems,
  prisma,
  upcomingWipes,
} from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotPower } from "@/components/BotPower";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { MapsButton } from "@/components/MapsButton";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { CYCLE_CHIP, SLOT_CHIP, mapsView } from "@/lib/maps";
import { toggleMapsAutoPick } from "./actions";

export const metadata = { title: "Карты вайпов" };

const HOUR = 3_600_000;

export default async function MapsOverview() {
  const user = await requirePage();
  const { s, fmt } = await mapsView();
  const [botState, rules, servers, secrets, open, problems] = await Promise.all([
    getBotStates(["maps"]).then((x) => x.maps!),
    prisma.mapsWipeRule.findMany(),
    prisma.mapsServer.findMany(),
    prisma.mapsSecret.findMany({ select: { name: true } }),
    prisma.mapsCycle.findMany({
      where: { status: { in: [...MAPS_OPEN_CYCLES, "sending"] }, wipeAt: { gt: new Date(Date.now() - 6 * HOUR) } },
      orderBy: { wipeAt: "asc" },
      include: { slots: { orderBy: { serverId: "asc" } } },
    }),
    prisma.botEvent.count({ where: { botKey: "maps", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  const have = new Set(secrets.map((x) => x.name));
  const missing = [
    ...MAPS_SECRETS.filter((m) => m.required && !have.has(m.name)).map((m) => m.label),
    ...(!s.s3Endpoint || !s.s3Bucket || !s.cdnBaseUrl ? ["адрес S3, бакет и адрес CDN"] : []),
    ...(have.has("telegramToken") && !s.telegramAdminIds.length ? ["Telegram ID админов"] : []),
  ];
  const ruleProblems = rules.flatMap((r) => mapsRuleProblems(r, servers).map((p) => `${r.key}: ${p}`));
  const titles = new Map(servers.map((x) => [x.id, x.title]));
  const started = new Set((await prisma.mapsCycle.findMany({ select: { id: true } })).map((c) => c.id));
  const wipes = upcomingWipes(rules, s.timezone).slice(0, 5);

  return (
    <>
      <PageHead title="Карты вайпов" hint={`Время — ${s.timezoneLabel}. Всё, что здесь можно сделать, можно сделать и кнопками бота в Telegram.`}>
        <div className="head-actions">
          <AutoRefresh seconds={10} />
          <BotPower botKey="maps" title="Карты вайпов" state={botState} canControl={user.level === "full"} />
        </div>
      </PageHead>

      {missing.length > 0 && (
        <p className="notice warn">
          Не настроено: {missing.join(", ")}.{" "}
          <Link href={user.level === "full" ? "/maps/connection" : "/maps/settings"} className="link">
            Настроить
          </Link>
        </p>
      )}
      {ruleProblems.length > 0 && (
        <p className="notice warn">
          Расписание с ошибками, по таким правилам генерация не начнётся: {ruleProblems.join("; ")}.{" "}
          <Link href="/maps/rules" className="link">Исправить</Link>
        </p>
      )}
      {problems > 0 && (
        <p className="notice warn">
          За сутки предупреждений или ошибок: {problems}.{" "}
          <Link href="/maps/events?level=problems" className="link">Открыть историю</Link>
        </p>
      )}

      <Section title="Подготовка к вайпам" hint="Вайпы, где генерация уже идёт. Нажми, чтобы выбрать карты, подтвердить и управлять анонсом.">
        {open.length === 0 ? (
          <EmptyState icon="map" title="Сейчас карты не готовятся" hint="Генерация начнётся сама по расписанию или раньше — кнопкой ниже." />
        ) : (
          <div className="server-grid">
            {open.map((c) => (
              <Link key={c.id} href={`/maps/cycles/${encodeURIComponent(c.id)}`} className="server-card" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="server-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="setting-title">{fmt(c.wipeAt)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      анонс {fmt(c.sendAt)}
                      {c.staging ? " · 🧪 staging" : ""}
                      {c.blueprints ? " · 🧹 глобальный" : ""}
                      {c.autoMode ? " · 🤖 автоподбор" : ""}
                    </div>
                  </div>
                  <span className={CYCLE_CHIP[c.status] ?? "chip"}>{MAPS_CYCLE_STATUS[c.status] ?? c.status}</span>
                </div>
                <div className="chips">
                  {c.slots.map((sl) => (
                    <span key={sl.id} className={SLOT_CHIP[sl.status] ?? "chip"} title={titles.get(sl.serverId)}>
                      #{sl.serverId}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="Ближайшие вайпы" hint="Расписание из раздела «Расписание». Генерация и анонс начинаются сами в указанное время.">
        {wipes.length === 0 ? (
          <EmptyState icon="clock" title="Вайпов в ближайшие 8 дней нет" hint="Проверь правила в разделе «Расписание»." />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Вайп</th>
                  <th>Серверы</th>
                  <th>Генерация</th>
                  <th>Анонс</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wipes.map((w) => {
                  const genAt = new Date(w.wipeAt.getTime() - (s.sendLeadHours + s.genLeadHours) * HOUR);
                  return (
                    <tr key={w.id}>
                      <td>
                        <b>{fmt(w.wipeAt)}</b>{" "}
                        {isStagingWipe(w.wipeAt, s.timezone) && <span className="chip">🧪 staging</span>}{" "}
                        {isBlueprintWipe(w.rule, w.wipeAt, s.timezone) && <span className="chip warn">🧹 глобальный</span>}
                      </td>
                      <td className="secondary">{w.rule.serverIds.map((id) => titles.get(id) ?? `#${id}`).join(", ")}</td>
                      <td className="secondary">{fmt(genAt)}</td>
                      <td className="secondary">{fmt(new Date(w.wipeAt.getTime() - s.sendLeadHours * HOUR))}</td>
                      <td style={{ width: 1 }}>
                        {started.has(w.id) ? (
                          <Link href={`/maps/cycles/${encodeURIComponent(w.id)}`} className="btn small">Открыть</Link>
                        ) : (
                          <MapsButton kind="gen.start" args={{ wipeId: w.id }} confirm={`Начать генерацию карт на ${fmt(w.wipeAt)} сейчас?`} confirmMessage="Анонс в Discord всё равно уйдёт в назначенное время.">
                            Сгенерировать сейчас
                          </MapsButton>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Автоподбор карт" hint="Бот сам выбирает лучшие карты из пула по оценке и предлагает набор целиком: подтвердить, перевыбрать или выбрать самому.">
        <div className="setting">
          <div className="setting-body">
            <div className="setting-title">{s.autoPick ? "Включён" : "Выключен"}</div>
            <div className="setting-hint">Для новых вайпов. Для вайпа, где генерация уже идёт, — кнопка «Подобрать автоматически» на его странице.</div>
          </div>
          <div className="setting-control">
            <ActionForm action={toggleMapsAutoPick}>
              <input type="hidden" name="autoPick" value={s.autoPick ? "" : "on"} />
              <SubmitButton variant={s.autoPick ? "secondary" : "primary"}>{s.autoPick ? "Выключить" : "Включить"}</SubmitButton>
            </ActionForm>
          </div>
        </div>
      </Section>
    </>
  );
}
