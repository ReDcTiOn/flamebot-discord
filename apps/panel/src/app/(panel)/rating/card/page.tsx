import { getCardLayout, getRatingSettings, prisma, rankProgress } from "@flamebot/core";
import { DEFAULT_CARD_LAYOUT, cardLayoutSchema, profileTexts, stripEmoji, type CardData } from "@flamebot/core/card";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CardEditor, type CardPresetItem } from "@/components/card/CardEditor";
import { ProfileTextsEditor } from "@/components/card/ProfileTexts";
import { FieldRow, PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord";
import { saveProfileCardEnabled } from "../actions";

export const metadata = { title: "Карточка профиля" };

export default async function CardPage() {
  const user = await requirePage();
  const [layout, settings, ranks, guild, presetRows] = await Promise.all([
    getCardLayout(prisma),
    getRatingSettings(prisma),
    prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
    prisma.guildInfo.findUnique({ where: { id: 1 } }),
    prisma.cardPreset.findMany({ orderBy: { name: "asc" } }),
  ]);
  // Всё через схему, чтобы порядок полей совпадал и текущую карточку можно было узнать в списке.
  const presets: CardPresetItem[] = presetRows.flatMap((p) => {
    const parsed = cardLayoutSchema.safeParse(p.layout);
    return parsed.success ? [{ id: p.id, name: p.name, layout: parsed.data, updatedAt: p.updatedAt.toISOString() }] : [];
  });

  // Для превью берём свой профиль, если он есть, иначе лидера рейтинга, иначе пример.
  const member =
    (await prisma.member.findUnique({ where: { id: user.id }, include: { badges: true } })) ??
    (await prisma.member.findFirst({ orderBy: { xp: "desc" }, include: { badges: true } }));

  const xp = member?.xp ?? 5230;
  const { current, next, ratio } = rankProgress(ranks, xp);
  const place = member ? (await prisma.member.count({ where: { xp: { gt: member.xp }, inGuild: true } })) + 1 : 7;

  const data: CardData = {
    name: member?.displayName ?? "Игрок",
    username: member?.username ?? "player",
    rank: current ? stripEmoji(current.name) : "Камень",
    nextRank: next ? stripEmoji(next.name) : "максимум",
    xp,
    nextXp: next?.minXp ?? null,
    progress: ranks.length ? ratio : 0.4,
    scrap: member?.scrap ?? 1245,
    rep: member?.rep ?? 38,
    messages: member?.messageCount ?? 117,
    place,
    server: guild?.name ?? "Сервер",
    badges: member?.badges.length ? member.badges.map((b) => b.label) : ["Помощник новичков", "Меценат"],
  };
  const previewAvatar = member ? avatarUrl(member.id, member.avatarHash, 256) : avatarUrl(user.id, user.avatarHash, 256);

  return (
    <>
      <PageHead
        title="Карточка профиля"
        hint={`Так выглядит ответ на /profile. В превью — ${member ? `профиль ${member.displayName}` : "пример игрока"}.`}
      />

      <ActionForm action={saveProfileCardEnabled}>
        <FieldRow icon="image" label="Показывать /profile картинкой" hint="Если выключить, бот ответит текстовой карточкой, как раньше">
          <Switch name="profileCardEnabled" defaultChecked={settings.profileCardEnabled} label="Показывать /profile картинкой" />
          <SubmitButton variant="secondary">Применить</SubmitButton>
        </FieldRow>
      </ActionForm>

      <div style={{ height: 20 }} />
      <CardEditor initialLayout={cardLayoutSchema.parse(layout)} defaultLayout={DEFAULT_CARD_LAYOUT} data={data} avatarUrl={previewAvatar} presets={presets} />

      <div style={{ height: 28 }} />
      <Section title="Текст под карточкой" hint="Бот пишет его в /profile под картинкой: что куплено и когда закончится. Разметка как в Discord, :имя: — эмодзи сервера по названию.">
        <ProfileTextsEditor initial={profileTexts(settings.profileTexts)} now={Date.now()} />
      </Section>
    </>
  );
}
