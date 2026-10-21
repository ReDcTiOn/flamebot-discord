import { Plus } from "lucide-react";
import { NOTICE_KIND_ICON, NOTICE_KIND_LABEL, prisma, renderNotice, type NoticeKind, type NoticeTemplate } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { PostPreview } from "@/components/notices/PostPreview";
import { requirePage } from "@/lib/auth";
import { noticesView } from "@/lib/notices";
import { deleteNoticeTemplate, saveNoticeTemplate } from "../actions";

export const metadata = { title: "Тексты объявлений" };

const EXAMPLE = {
  content: "@everyone",
  username: "FlameRust",
  embeds: [{ title: "❗ Вайп карты ❗", description: "FlameRust #1 — connect s1.flamerust.ru\n\nВайп {weekday}, {date} в {time} МСК", color: 16372510 }],
};

function TemplateFields({ t }: { t?: NoticeTemplate }) {
  return (
    <div className="form-grid">
      {t && <input type="hidden" name="originalId" value={t.id} />}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label className="stack">
          <span>Название</span>
          <input type="text" name="title" defaultValue={t?.title} required maxLength={80} className="wide" placeholder="Пятница · обычный (#1–#4)" />
        </label>
        <label className="stack">
          <span>ID (латиницей, потом не меняется)</span>
          <input type="text" name="id" defaultValue={t?.id} required maxLength={32} pattern="[A-Za-z0-9_\-]+" readOnly={!!t} className="wide" placeholder="fri_regular" />
        </label>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <label className="stack">
          <span>Тип вайпа</span>
          <select name="kind" defaultValue={t?.kind ?? "regular"} className="wide">
            <option value="regular">🟢 обычный (чертежи сохраняются)</option>
            <option value="global">🔴 глобальный (чертежи удаляются)</option>
          </select>
        </label>
        <label className="stack">
          <span>Скидка промокода, % (пусто — не нужен)</span>
          <input type="number" name="promoAmount" defaultValue={t?.promoAmount ?? ""} min={1} max={100} className="wide" />
        </label>
        <label className="stack">
          <span>Порядок в списке</span>
          <input type="number" name="sortOrder" defaultValue={t?.sortOrder ?? 0} min={-1000} max={1000} className="wide" />
        </label>
      </div>
      <label className="stack">
        <span>Discord: JSON тела вебхука (content, username, embeds…). Картинку бот подставит сам</span>
        <textarea name="discord" required rows={12} className="wide" spellCheck={false} style={{ fontFamily: "var(--mono)", fontSize: 12.5 }} defaultValue={JSON.stringify(t?.discord ?? EXAMPLE, null, 2)} />
      </label>
      <label className="stack">
        <span>ВКонтакте: текст поста</span>
        <textarea name="vk" required rows={8} maxLength={15000} className="wide" defaultValue={t?.vk ?? ""} />
      </label>
      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        Подстановки: <code>{"{date}"}</code> — 06.10, <code>{"{time}"}</code> — 14:00, <code>{"{weekday}"}</code> — вторник, <code>{"{ts}"}</code> — время Unix для{" "}
        <code>{"<t:{ts}:R>"}</code> в Discord.
      </p>
    </div>
  );
}

export default async function NoticeTemplatesPage() {
  await requirePage();
  const { s } = await noticesView();
  const [templates, rules, images] = await Promise.all([
    prisma.noticeTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.noticeRule.findMany({ select: { key: true, regularTemplateId: true, globalTemplateId: true } }),
    prisma.noticeImage.findMany({ select: { kind: true, updatedAt: true } }),
  ]);
  // Превью — на ближайшую пятницу в 14:00, чтобы подстановки были видны.
  const sample = new Date(Date.now() + 7 * 86_400_000);

  return (
    <>
      <PageHead title="Тексты" hint="Заготовки объявлений. Какой текст уходит по умолчанию, выбирается в «Расписании»; на конкретный вайп текст меняют в Telegram или на странице вайпа.">
        <ModalTrigger
          label={
            <>
              <Plus size={16} aria-hidden="true" /> Добавить текст
            </>
          }
          buttonClass="btn primary"
          title="Новый текст"
          size="lg"
        >
          <ActionForm action={saveNoticeTemplate}>
            <TemplateFields />
            <div className="modal-actions">
              <ModalCancel />
              <SubmitButton>Добавить</SubmitButton>
            </div>
          </ActionForm>
        </ModalTrigger>
      </PageHead>

      {templates.length === 0 ? (
        <EmptyState icon="message" title="Текстов нет" hint="Добавь их здесь или перенеси из прежнего бота (README, «Переезд с прежнего бота»)." />
      ) : (
        <div className="tiles">
          {templates.map((t) => {
            const kind = t.kind as NoticeKind;
            const usedIn = rules.filter((r) => r.regularTemplateId === t.id || r.globalTemplateId === t.id).map((r) => r.key);
            const img = images.find((i) => i.kind === kind);
            const rendered = renderNotice(t, sample, s.timezone);
            return (
              <div key={t.id} className="setting" style={{ alignItems: "flex-start" }}>
                <div className="setting-body">
                  <div className="setting-title">
                    {NOTICE_KIND_ICON[kind]} {t.title} <span className="muted">· {t.id}</span>
                  </div>
                  <div className="setting-hint">
                    {NOTICE_KIND_LABEL[kind]} вайп · {t.promoAmount ? `🎟 промокод ${t.promoAmount}%` : "без промокода"}
                    {usedIn.length > 0 && ` · по умолчанию в правилах: ${usedIn.join(", ")}`}
                  </div>
                </div>
                <div className="setting-control">
                  <div className="row-actions">
                    <ModalTrigger label="Превью" buttonClass="btn small" title={t.title} size="lg">
                      <PostPreview discord={rendered.discord} vk={rendered.vk} imageUrl={img ? `/api/notices/image/${kind}?v=${img.updatedAt.getTime()}` : null} />
                    </ModalTrigger>
                    <ModalTrigger label="Изменить" buttonClass="btn small" title={t.title} size="lg">
                      <ActionForm action={saveNoticeTemplate}>
                        <TemplateFields t={t} />
                        <div className="modal-actions">
                          <ModalCancel />
                          <SubmitButton>Сохранить</SubmitButton>
                        </div>
                      </ActionForm>
                    </ModalTrigger>
                    <ActionForm action={deleteNoticeTemplate} confirm={`Удалить текст «${t.title}»?`} confirmLabel="Удалить" danger>
                      <input type="hidden" name="id" value={t.id} />
                      <SubmitButton variant="danger">Удалить</SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
