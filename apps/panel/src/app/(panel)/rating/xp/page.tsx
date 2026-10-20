import { Plus } from "lucide-react";
import { formatNumber, getRatingSettings, messageReward, prisma, type Rank } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, FieldRow, NumberInput, PageHead, RoleSelect, Section, Switch, Tabs, pickTab } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { listRoles } from "@/lib/guild";
import { createRank, deleteRank, saveXpSettings, updateRank } from "../actions";

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
        <label className="stack">
          <span>Эмодзи</span>
          <input type="text" name="emoji" defaultValue={rank?.emoji ?? ""} placeholder="☢️" maxLength={32} className="wide" />
        </label>
      </div>
      <div className="grid grid-2">
        <label className="stack">
          <span>Порог опыта</span>
          <input type="number" name="minXp" defaultValue={rank?.minXp} placeholder="25000" min={0} required className="wide" />
        </label>
        <label className="stack">
          <span>Награда скрапом за ранг</span>
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
            <span>Скрап</span>
            <input type="number" name="scrapPerMessage" defaultValue={rank?.scrapPerMessage ?? ""} min={0} max={1000} step={0.01} inputMode="decimal" className="wide" placeholder={String(defaults.scrap)} />
          </label>
        </div>
      </fieldset>
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
      <PageHead title="Опыт и ранги" hint="Игроки получают опыт за сообщения в чате и растут по рангам." />
      <Tabs tabs={[...TABS]} active={tab} base="/rating/xp" />

      {tab === "xp" && (
        <ActionForm action={saveXpSettings}>
          <Section title="Сообщения" hint="Сколько опыта и скрапа приносит одно сообщение">
            <div className="tiles">
              <FieldRow icon="trending" label="Опыт за сообщение" hint="Случайное значение от и до, можно с сотыми: 0.01. Для ранга можно задать своё">
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
              <FieldRow icon="coin" label="Скрап за начисление опыта" hint="Начисляется вместе с опытом, можно с сотыми. Для ранга можно задать своё">
                <NumberInput name="scrapPerAward" defaultValue={s.scrapPerAward} min={0} max={1000} step={0.01} label="Скрап" />
              </FieldRow>
              <FieldRow icon="mic" label="Опыт за голосовые каналы" hint="Появится в следующих версиях">
                <Switch name="voiceXpEnabled" defaultChecked={false} disabled label="Опыт за голосовые каналы" />
              </FieldRow>
            </div>
          </Section>

          <Section title="Ранги и роли">
            <div className="tiles">
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
              <EmptyState icon="trending" title="Рангов пока нет" hint="Добавь первый ранг с порогом 0 опыта." />
            ) : (
              <div className="tiles">
                {ranks.map((r, i) => (
                  <div key={r.id} className="setting">
                    <div className="setting-icon rank-emoji" aria-hidden="true">
                      {r.emoji || i + 1}
                    </div>
                    <div className="setting-body">
                      <div className="setting-title">{r.name}</div>
                      <div className="setting-hint">
                        от {r.minXp.toLocaleString("ru-RU")} опыта
                        {r.roleId ? ` · роль @${roleName.get(r.roleId) ?? "удалена"}` : " · без роли"}
                        {r.scrapReward > 0 ? ` · награда ${r.scrapReward.toLocaleString("ru-RU")} скрапа` : ""}
                        {(() => {
                          const m = messageReward(s, r);
                          const own = r.xpMin !== null || r.scrapPerMessage !== null;
                          return ` · за сообщение ${formatNumber(m.xpMin)}–${formatNumber(m.xpMax)} опыта и ${formatNumber(m.scrap)} скрапа${own ? "" : " (общие)"}`;
                        })()}
                      </div>
                    </div>
                    <div className="row-actions">
                      <ModalTrigger label="Изменить" buttonClass="btn small" title={`Ранг «${r.name}»`} description="Роли участников пересчитаются в фоне после сохранения.">
                        <ActionForm action={updateRank}>
                          <input type="hidden" name="id" value={r.id} />
                          <RankFields roles={roles} rank={r} defaults={defaults} />
                          <div className="modal-actions">
                            <ModalCancel />
                            <SubmitButton>Сохранить</SubmitButton>
                          </div>
                        </ActionForm>
                        <div className="danger-zone">
                          <h3>Удалить ранг</h3>
                          <p className="secondary" style={{ fontSize: 13, marginBottom: 10 }}>
                            Игроки этого ранга перейдут на предыдущий, роль ранга с них снимется.
                          </p>
                          <ActionForm action={deleteRank} confirm={`Удалить ранг «${r.name}»?`} confirmLabel="Удалить" danger>
                            <input type="hidden" name="id" value={r.id} />
                            <SubmitButton variant="danger">Удалить ранг</SubmitButton>
                          </ActionForm>
                        </div>
                      </ModalTrigger>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </>
  );
}
