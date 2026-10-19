import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, RoleSelect, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { listRoles } from "@/lib/guild";
import { createRank, deleteRank, saveXpSettings, updateRank } from "../actions";

export const metadata = { title: "Опыт и ранги" };

const RANK_GRID = { display: "grid", gridTemplateColumns: "1.3fr 70px 110px 1.6fr 100px auto", gap: 8, alignItems: "center" } as const;

export default async function XpPage() {
  await requirePage();
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
      <div className="page-head">
        <div>
          <h1>Опыт и ранги</h1>
          <p>Опыт начисляется за сообщения в чате. Голосовые каналы пока не учитываются.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Начисление опыта</h2></div>
        <ActionForm action={saveXpSettings}>
          <FieldRow label="Опыт за сообщение" hint="Случайное значение в диапазоне от и до">
            <NumberInput name="xpMin" defaultValue={s.xpMin} min={0} max={1000} />
            <span className="muted">–</span>
            <NumberInput name="xpMax" defaultValue={s.xpMax} min={0} max={1000} />
          </FieldRow>
          <FieldRow label="Кулдаун, секунд" hint="Чаще этого опыт одному человеку не начисляется">
            <NumberInput name="xpCooldownSec" defaultValue={s.xpCooldownSec} min={5} max={3600} />
          </FieldRow>
          <FieldRow label="Минимальная длина сообщения" hint="Короткие «ок» и «+» опыт не дают">
            <NumberInput name="minMessageLength" defaultValue={s.minMessageLength} min={0} max={500} />
          </FieldRow>
          <FieldRow label="Скрап за начисление опыта">
            <NumberInput name="scrapPerAward" defaultValue={s.scrapPerAward} min={0} max={1000} />
          </FieldRow>
          <FieldRow label="Опыт за голосовые каналы" hint="Появится в следующих версиях">
            <Switch name="voiceXpEnabled" defaultChecked={false} disabled label="Опыт за голосовые каналы" />
          </FieldRow>
          <FieldRow label="Объявлять о новом ранге" hint="Канал и текст настраиваются в разделах «Каналы» и «Сообщения»">
            <Switch name="announceRankUp" defaultChecked={s.announceRankUp} label="Объявлять о новом ранге" />
          </FieldRow>
          <FieldRow label="Снимать роли прошлых рангов" hint="Иначе у игрока копятся роли всех пройденных рангов">
            <Switch name="removeOldRankRoles" defaultChecked={s.removeOldRankRoles} label="Снимать роли прошлых рангов" />
          </FieldRow>
          <div className="form-actions">
            <SubmitButton>Сохранить</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Ранги</h2>
            <p>
              {messagesToTop && hoursToTop !== null
                ? `До «${top!.name}» нужно около ${messagesToTop.toLocaleString("ru-RU")} сообщений, это минимум ${hoursToTop} ч активного общения.`
                : "Добавь ранги, чтобы игроки росли."}
            </p>
          </div>
        </div>

        {roles.length === 0 && <p className="notice warn">Список ролей появится, когда бот подключится к серверу.</p>}

        <div style={{ ...RANK_GRID, fontSize: 12, color: "var(--text-muted)", padding: "0 0 6px" }}>
          <span>Название</span><span>Эмодзи</span><span>Порог опыта</span><span>Роль Discord</span><span>Награда</span><span />
        </div>

        {ranks.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", borderTop: "1px solid var(--border)", padding: "8px 0" }}>
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

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
          <div className="field-label" style={{ marginBottom: 8 }}>Новый ранг</div>
          <ActionForm action={createRank} resetOnSuccess>
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
      </div>
    </>
  );
}
