import { prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BotConnection } from "@/components/BotConnection";
import { Section } from "@/components/Fields";
import { SecretField } from "@/components/SecretField";
import { requirePage } from "@/lib/auth";
import { clearGiveawayFlameRustKey, saveGiveawayFlameRustKey } from "./actions";

export const metadata = { title: "Подключение бота розыгрышей" };

export default async function GiveawayConnectionPage() {
  await requirePage("full");
  const saved = await prisma.giveawaySecret.findUnique({
    where: { name: "flamerustApiKey" },
    select: { setAt: true, setByName: true },
  });
  const savedAt = saved ? [
    saved.setAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" }),
    saved.setByName,
  ].filter(Boolean).join(", ") : null;

  return (
    <>
      <BotConnection botKey="giveaway" />
      <Section
        title="Промокоды flamerust.gg"
        hint="Для команды /розыгрыш быстрый нужен ключ внешнего API с правом создавать балансовые промокоды."
      >
        <ActionForm action={saveGiveawayFlameRustKey}>
          <div className="card form-grid">
            <SecretField
              key={saved?.setAt.toISOString() ?? "empty"}
              name="flamerustApiKey"
              label="API-ключ flamerust.gg"
              placeholder="Ключ внешнего API"
              saved={!!saved}
              savedAt={savedAt}
              required
            />
            <div className="form-actions">
              <SubmitButton>Сохранить ключ</SubmitButton>
            </div>
          </div>
        </ActionForm>
        {saved && (
          <ActionForm
            action={clearGiveawayFlameRustKey}
            confirm="Удалить API-ключ flamerust.gg?"
            confirmMessage="Быстрый розыгрыш снова сможет создавать промокоды после сохранения нового ключа."
            confirmLabel="Удалить"
            danger
          >
            <SubmitButton variant="danger">Удалить ключ</SubmitButton>
          </ActionForm>
        )}
      </Section>
    </>
  );
}
