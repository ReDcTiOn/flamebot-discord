import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, RoleSelect, Section, Switch, Tabs, pickTab } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { listRoles } from "@/lib/guild";
import { createRank, deleteRank, saveXpSettings, updateRank } from "../actions";

export const metadata = { title: "Опыт и ранги" };

const TABS = [
  { key: "xp", label: "Начисление опыта" },
  { key: "ranks", label: "Ранги" },
] as const;

const RANK_GRID = { display: "grid", gridTemplateColumns: "1.3fr 64px 110px 1.6fr 96px auto", gap: 8, alignItems: "center" } as const;

export default async function XpPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage();
  const tab = pickTab((await searchParams).tab, TABS.map((t) => t.key));
  const [s, ranks, roles] = await Promise.all([
    getRatingSettings(prisma),
    prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
    listRoles(),
  ]);

  const avgGain = (s.xpMin + s.xpMax) / 2;
  const top = ranks.at(-1);
  const messagesToTop = top && avgGain > 0 ? Math.ceil(top.minXp / avgGain) : null;
  const hoursToTop = messagesToTop ? Math.round((messagesToTop * s.xpCooldownSec) / 3600) : null;

  return (
    <>
      <PageHead title="Опыт и ранги" hint="Игроки получают опыт за сообщения в чате и растут по рангам." />
      <Tabs tabs={[...TABS]} active={tab} base="/rating/xp" />

      {tab === "xp" && (
        <ActionForm action={saveXpSettings}>
          <Section title="Сообщения" hint="Сколько опыта и скрапа приносит одно сообщение">
            <div className="tiles">
              <FieldRow icon="trending" label="Опыт за сообщение" hint="Случайное значение в диапазоне от и до">
                <NumberInput name="xpMin" defaultValue={s.xpMin} min={0} max={1000} label="Минимум опыта" />
                <span className="muted">–</span>
                <NumberInput name="xpMax" defaultValue={s.xpMax} min={0} max={1000} label="Максимум опыта" />
              </FieldRow>
              <FieldRow icon="clock" label="Кулдаун, секунд" hint="Чаще этого опыт одному человеку не начисляется">
                <NumberInput name="xpCooldownSec" defaultValue={s.xpCooldownSec} min={5} max={3600} label="Кулдаун" />
              </FieldRow>
              <FieldRow icon="ruler" label="Минимальная длина сообщения" hint="Короткие «ок» и «+» опыт не дают">
                <NumberInput name="minMessageLength" defaultValue={s.minMessageLength} min={0} max={500} label="Минимальная длина" />
              </FieldRow>
              <FieldRow icon="coin" label="Скрап за начисление опыта" hint="Начисляется вместе с опытом">
                <NumberInput name="scrapPerAward" defaultValue={s.scrapPerAward} min={0} max={1000} label="Скрап" />
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
          >
            <div style={{ ...RANK_GRID, fontSize: 12, color: "var(--text-muted)", padding: "0 15px 8px 15px" }}>
              <span>Название</span><span>Эмодзи</span><span>Порог опыта</span><span>Роль Discord</span><span>Награда</span><span />
            </div>
            <div className="tiles">
              {ranks.map((r) => (
                <div key={r.id} className="setting" style={{ alignItems: "flex-start" }}>
                  <ActionForm action={updateRank} className="rank-form">
                    <input type="hidden" name="id" value={r.id} />
                    <div style={RANK_GRID}>
                      <input type="text" name="name" defaultValue={r.name} maxLength={50} required aria-label="Название" />
                      <input type="text" name="emoji" defaultValue={r.emoji ?? ""} maxLength={32} aria-label="Эмодзи" />
                      <input type="number" name="minXp" defaultValue={r.minXp} min={0} required aria-label="Порог опыта" />
                      <RoleSelect name="roleId" roles={roles} defaultValue={r.roleId} />
                      <input type="number" name="scrapReward" defaultValue={r.scrapReward} min={0} required aria-label="Награда скрапом" />
                      <SubmitButton variant="secondary">Сохранить</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm action={deleteRank} confirm={`Удалить ранг «${r.name}»?`}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton variant="danger">Удалить</SubmitButton>
                  </ActionForm>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Новый ранг" hint="Роли с правами модерации выбрать нельзя: бот их не выдаёт.">
            <div className="setting">
              <ActionForm action={createRank} resetOnSuccess className="rank-form">
                <div style={RANK_GRID}>
                  <input type="text" name="name" placeholder="Бункер" maxLength={50} required aria-label="Название" />
                  <input type="text" name="emoji" placeholder="☢️" maxLength={32} aria-label="Эмодзи" />
                  <input type="number" name="minXp" placeholder="25000" min={0} required aria-label="Порог опыта" />
                  <RoleSelect name="roleId" roles={roles} defaultValue={null} />
                  <input type="number" name="scrapReward" defaultValue={0} min={0} required aria-label="Награда скрапом" />
                  <SubmitButton>Добавить</SubmitButton>
                </div>
              </ActionForm>
            </div>
          </Section>
        </>
      )}
    </>
  );
}
