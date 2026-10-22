import { Plus, Trash2 } from "lucide-react";
import { formatNumber, getRatingSettings, levelTotalExp, messageReward, prisma, type Rank } from "@flamebot/core";
import { ActionForm, IconSubmit, SubmitButton } from "@/components/ActionForm";
import { EmojiPicker } from "@/components/EmojiPicker";
import { ExpandableRow } from "@/components/ui/ExpandableRow";
import { EmptyState, FieldRow, NumberInput, PageHead, RoleSelect, Section, Switch, Tabs, pickTab } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { listRoles } from "@/lib/guild";
import { createRank, deleteRank, saveXpSettings, updateRank } from "../actions";
import { ScrapIcon } from "@/components/ScrapIcon";

export const metadata = { title: "Опыт и ранги" };

const TABS = [
  { key: "xp", label: "Начисление опыта" },
  { key: "ranks", label: "Ранги" },
] as const;

type Roles = Awaited<ReturnType<typeof listRoles>>;

function RankFields({ roles, rank, defaults }: { roles: Roles; rank?: Rank; defaults: { xpMin: number; xpMax: number; scrap: number } }) {
  return (
    <div className="form-grid">
      <div className="grid" style={{ gridTemplateColumns: "1fr 96px" }}>
        <label className="stack">
          <span>Название</span>
          <input type="text" name="name" defaultValue={rank?.name} placeholder="Бункер" maxLength={50} required className="wide" />
        </label>
        <div className="stack">
          <span className="field-label">Эмодзи</span>
          <EmojiPicker name="emoji" defaultValue={rank?.emoji ?? null} label="Эмодзи ранга" />
        </div>
      </div>
      <div className="grid grid-2">
        <label className="stack">
          <span>С какого уровня</span>
          <input type="number" name="minLevel" defaultValue={rank?.minLevel} placeholder="10" min={1} max={999} required className="wide" />
        </label>
        <label className="stack">
          <span>Награда за ранг, <ScrapIcon /></span>
          <input type="number" name="scrapReward" defaultValue={rank?.scrapReward ?? 0} min={0} required className="wide" />
        </label>
      </div>
      <fieldset className="rank-rewards">
        <legend className="prop-label">За одно сообщение на этом ранге — пусто значит «как в общих настройках»</legend>
        <div className="grid grid-3">
          <label className="stack">
            <span>Опыт от</span>
            <input type="number" name="xpMin" defaultValue={rank?.xpMin ?? ""} min={0} max={1000} step={0.01} inputMode="decimal" className="wide" placeholder={String(defaults.xpMin)} />
          </label>
          <label className="stack">
            <span>Опыт до</span>
            <input type="number" name="xpMax" defaultValue={rank?.xpMax ?? ""} min={0} max={1000} step={0.01} inputMode="decimal" className="wide" placeholder={String(defaults.xpMax)} />
          </label>
          <label className="stack">
            <span><ScrapIcon /> Скрап</span>
            <input type="number" name="scrapPerMessage" defaultValue={rank?.scrapPerMessage ?? ""} min={0} max={1000} step={0.01} inputMode="decimal" className="wide" placeholder={String(defaults.scrap)} />
          </label>
        </div>
      </fieldset>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Опыт уровня — как в JuniperBot: 5 ур. — {formatNumber(levelTotalExp(5))}, 10 — {formatNumber(levelTotalExp(10))}, 20 — {formatNumber(levelTotalExp(20))}, 30 — {formatNumber(levelTotalExp(30))}.
      </p>
      <label className="stack">
        <span>Роль Discord, которую выдаёт бот</span>
        <RoleSelect name="roleId" roles={roles} defaultValue={rank?.roleId ?? null} />
      </label>
    </div>
  );
}

export default async function XpPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage();
  const tab = pickTab((await searchParams).tab, TABS.map((t) => t.key));
  const [s, ranks, roles] = await Promise.all([
    getRatingSettings(prisma),
    prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
    listRoles(),
  ]);

  const roleName = new Map(roles.map((r) => [r.id, r.name]));
  const defaults = { xpMin: s.xpMin, xpMax: s.xpMax, scrap: s.scrapPerAward };
  const top = ranks.at(-1);
  // Идём по лестнице: на каждом отрезке своё среднее начисление за сообщение.
  let messagesToTop: number | null = top ? 0 : null;
  for (let i = 0; top && messagesToTop !== null && i < ranks.length - 1; i++) {
    const r = messageReward(s, ranks[i]!);
    const avg = (r.xpMin + r.xpMax) / 2;
    const span = ranks[i + 1]!.minXp - ranks[i]!.minXp;
    messagesToTop = avg > 0 ? messagesToTop + Math.ceil(span / avg) : null;
  }
  if (top && ranks[0] && ranks[0].minXp > 0 && messagesToTop !== null) {
    const avg = (s.xpMin + s.xpMax) / 2;
    messagesToTop = avg > 0 ? messagesToTop + Math.ceil(ranks[0].minXp / avg) : null;
  }
  const hoursToTop = messagesToTop ? Math.round((messagesToTop * s.xpCooldownSec) / 3600) : null;

  return (
    <>
      <PageHead title="Опыт и ранги" hint="Как в JuniperBot: опыт за сообщения и голос, уровни по той же формуле, ранги выдаются с нужного уровня." />
      <Tabs tabs={[...TABS]} active={tab} base="/rating/xp" />

      {tab === "xp" && (
        <ActionForm action={saveXpSettings}>
          <Section title="Сообщения" hint="Сколько опыта и скрапа приносит одно сообщение">
            <div className="tiles group">
              <FieldRow icon="trending" label="Опыт за сообщение" hint="Случайное значение от и до. В JuniperBot 15–24 раз в минуту. Целые границы — целый опыт">
                <NumberInput name="xpMin" defaultValue={s.xpMin} min={0} max={1000} step={0.01} label="Минимум опыта" />
                <span className="muted">–</span>
                <NumberInput name="xpMax" defaultValue={s.xpMax} min={0} max={1000} step={0.01} label="Максимум опыта" />
              </FieldRow>
              <FieldRow icon="clock" label="Кулдаун, секунд" hint="Чаще этого опыт одному человеку не начисляется">
                <NumberInput name="xpCooldownSec" defaultValue={s.xpCooldownSec} min={5} max={3600} label="Кулдаун" />
              </FieldRow>
              <FieldRow icon="ruler" label="Минимальная длина сообщения" hint="Короткие «ок» и «+» опыт не дают">
                <NumberInput name="minMessageLength" defaultValue={s.minMessageLength} min={0} max={500} label="Минимальная длина" />
              </FieldRow>
              <FieldRow icon="scrap" label="Скрап за начисление опыта" hint="Начисляется вместе с опытом, можно с сотыми. Для ранга можно задать своё">
                <NumberInput name="scrapPerAward" defaultValue={s.scrapPerAward} min={0} max={1000} step={0.01} label="Скрап" />
              </FieldRow>
            </div>
          </Section>

          <Section title="Голосовые каналы" hint="Как в JuniperBot: опыт идёт, пока у человека включён микрофон и в канале есть ещё хотя бы один с включённым микрофоном. AFK-канал и боты не считаются.">
            <div className="tiles group">
              <FieldRow icon="mic" label="Опыт за голос">
                <Switch name="voiceXpEnabled" defaultChecked={s.voiceXpEnabled} label="Опыт за голос" />
              </FieldRow>
              <FieldRow icon="users" label="Опыт в минуту за каждого с микрофоном" hint={`Считая себя: вдвоём по ${s.voiceXpPerMember * 2}, втроём по ${s.voiceXpPerMember * 3} в минуту. В JuniperBot — 6`}>
                <NumberInput name="voiceXpPerMember" defaultValue={s.voiceXpPerMember} min={0} max={1000} label="Опыт в минуту за каждого" />
              </FieldRow>
            </div>
          </Section>

          <Section title="Ранги и роли">
            <div className="tiles group">
              <FieldRow icon="megaphone" label="Объявлять о новом ранге" hint="Канал и текст настраиваются в разделах «Каналы» и «Сообщения»">
                <Switch name="announceRankUp" defaultChecked={s.announceRankUp} label="Объявлять о новом ранге" />
              </FieldRow>
              <FieldRow icon="repeat" label="Снимать роли прошлых рангов" hint="Иначе у игрока копятся роли всех пройденных рангов">
                <Switch name="removeOldRankRoles" defaultChecked={s.removeOldRankRoles} label="Снимать роли прошлых рангов" />
              </FieldRow>
            </div>
          </Section>

          <div className="save-bar">
            <SubmitButton>Сохранить изменения</SubmitButton>
          </div>
        </ActionForm>
      )}

      {tab === "ranks" && (
        <>
          {roles.length === 0 && <p className="notice warn">Список ролей появится, когда бот подключится к серверу.</p>}
          <Section
            title="Лестница рангов"
            hint={
              messagesToTop && hoursToTop !== null
                ? `До «${top!.name}» нужно около ${messagesToTop.toLocaleString("ru-RU")} сообщений, это минимум ${hoursToTop} ч активного общения.`
                : "Добавь ранги, чтобы игроки росли."
            }
            action={
              <ModalTrigger
                label={
                  <>
                    <Plus size={16} aria-hidden="true" /> Добавить ранг
                  </>
                }
                buttonClass="btn primary"
                title="Новый ранг"
                description="Роли с правами модерации выбрать нельзя: бот их не выдаёт."
              >
                <ActionForm action={createRank} resetOnSuccess>
                  <RankFields roles={roles} defaults={defaults} />
                  <div className="modal-actions">
                    <ModalCancel />
                    <SubmitButton>Добавить ранг</SubmitButton>
                  </div>
                </ActionForm>
              </ModalTrigger>
            }
          >
            {ranks.length === 0 ? (
              <EmptyState icon="trending" title="Рангов пока нет" hint="Добавь первый ранг и укажи, с какого уровня он выдаётся." />
            ) : (
              <div className="tiles">
                {ranks.map((r, i) => (
                  <ExpandableRow
                    key={r.id}
                    icon={
                      <div className="setting-icon rank-emoji" aria-hidden="true">
                        {r.emoji || i + 1}
                      </div>
                    }
                    title={r.name}
                    hint={
                      <>
                        с {r.minLevel} уровня ({r.minXp.toLocaleString("ru-RU")} опыта)
                        {r.roleId ? ` · роль @${roleName.get(r.roleId) ?? "удалена"}` : " · без роли"}
                        {r.scrapReward > 0 && (
                          <>
                            {` · награда ${r.scrapReward.toLocaleString("ru-RU")} `}
                            <ScrapIcon />
                          </>
                        )}
                        {(() => {
                          const m = messageReward(s, r);
                          const own = r.xpMin !== null || r.scrapPerMessage !== null;
                          return (
                            <>
                              {` · за сообщение ${formatNumber(m.xpMin)}–${formatNumber(m.xpMax)} опыта и ${formatNumber(m.scrap)} `}
                              <ScrapIcon />
                              {own ? "" : " (общие)"}
                            </>
                          );
                        })()}
                      </>
                    }
                    toggleLabel={`Изменить ранг «${r.name}»`}
                    actions={
                      <ActionForm
                        action={deleteRank}
                        confirm={`Удалить ранг «${r.name}»?`}
                        confirmMessage="Игроки этого ранга перейдут на предыдущий, роль ранга с них снимется. Отменить нельзя."
                        confirmLabel="Удалить"
                        danger
                      >
                        <input type="hidden" name="id" value={r.id} />
                        <IconSubmit label={`Удалить ранг «${r.name}»`} danger>
                          <Trash2 size={15} aria-hidden="true" />
                        </IconSubmit>
                      </ActionForm>
                    }
                  >
                    <ActionForm action={updateRank}>
                      <input type="hidden" name="id" value={r.id} />
                      <RankFields roles={roles} rank={r} defaults={defaults} />
                      <div className="modal-actions">
                        <span className="muted spacer">Роли участников пересчитаются в фоне после сохранения.</span>
                        <ModalCancel />
                        <SubmitButton>Сохранить</SubmitButton>
                      </div>
                    </ActionForm>
                  </ExpandableRow>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
