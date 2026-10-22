import { z } from "zod";

// Тексты под карточкой в ответе на /profile: список покупок. Редактируются в панели.
// :имя: — эмодзи сервера по названию, бот подставит его сам. Остальная разметка — как в Discord.

export const PROFILE_TEXT_DEFAULTS = {
  purchasesTitle: "### :flamerust_coins: Покупки",
  itemTimed: "**{item}** – до {date}, {left}",
  itemForever: "**{item}** – навсегда",
  itemPending: "**{item}** – на проверке у администрации",
  empty: "Покупок нет. Загляни в /shop",
  footer: "-# Купить ещё – /shop",
} as const;

export type ProfileTexts = { -readonly [K in keyof typeof PROFILE_TEXT_DEFAULTS]: string };

const line = z.string().trim().max(300);

export const profileTextsSchema = z.object({
  purchasesTitle: line,
  itemTimed: line.min(1, "Строка покупки со сроком не может быть пустой"),
  itemForever: line.min(1, "Строка покупки навсегда не может быть пустой"),
  itemPending: line.min(1, "Строка заявки на проверке не может быть пустой"),
  empty: line,
  footer: line,
});

export const PROFILE_TEXT_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "{item}", label: "что куплено" },
  { key: "{date}", label: "дата окончания" },
  { key: "{left}", label: "сколько осталось: «через 14 дней»" },
  { key: "{price}", label: "цена" },
];

// Из базы: неизвестные и испорченные поля заменяются стандартными.
export function profileTexts(raw: unknown): ProfileTexts {
  const out: ProfileTexts = { ...PROFILE_TEXT_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(PROFILE_TEXT_DEFAULTS) as (keyof ProfileTexts)[]) {
      const parsed = profileTextsSchema.shape[key].safeParse((raw as Record<string, unknown>)[key]);
      if (parsed.success) out[key] = parsed.data;
    }
  }
  return out;
}

export interface ProfilePurchase {
  item: string;
  price: number;
  expiresAt: Date | null;
  pending: boolean;
}

const nf = new Intl.NumberFormat("ru-RU");

// Блок покупок в разметке Discord. Даты — метки времени Discord: каждый видит их в своём поясе.
export function purchasesBlock(texts: ProfileTexts, purchases: ProfilePurchase[]): string {
  const fill = (template: string, p: ProfilePurchase) => {
    const ts = p.expiresAt ? Math.floor(p.expiresAt.getTime() / 1000) : null;
    const values: Record<string, string> = {
      item: p.item,
      price: nf.format(p.price),
      date: ts ? `<t:${ts}:D>` : "",
      left: ts ? `<t:${ts}:R>` : "",
    };
    return template.replace(/\{(\w+)\}/g, (m, key: string) => (Object.hasOwn(values, key) ? values[key]! : m));
  };
  const lines = purchases.map((p) => fill(p.pending ? texts.itemPending : p.expiresAt ? texts.itemTimed : texts.itemForever, p));
  const body = lines.length > 0 ? lines.join("\n") : texts.empty;
  return [texts.purchasesTitle, body, texts.footer].filter((s) => s.trim()).join("\n");
}
