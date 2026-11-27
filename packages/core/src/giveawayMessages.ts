import { renderTemplate } from "./util.js";

export const GIVEAWAY_MESSAGES = {
  everyone: { group: "Публикация", label: "Массовое упоминание", text: "||@everyone||", optional: true },
  endTime: { group: "Карточка", label: "Время итогов", text: "⏳ **Итоги** · {time} · {relative}", optional: true },
  boosters: { group: "Карточка", label: "Условие буста", text: "🚀 Участвовать могут только бустеры сервера.", optional: true },
  promoHint: { group: "Карточка", label: "Получение приза", text: "🎟 Победители получат промокод в ЛС или смогут забрать его здесь после итогов.", optional: true },
  winners: { group: "Карточка", label: "Победители", text: "**🏆 Победители**\n{winners}", optional: false },
  noWinners: { group: "Карточка", label: "Победителей нет", text: "Победителей нет.", optional: false },
  moreWinners: { group: "Карточка", label: "Остальные победители", text: " и ещё {count}", optional: false },
  cancelled: { group: "Карточка", label: "Отмена", text: "## Розыгрыш отменён\n{prize}", optional: false },
  claimHint: { group: "Карточка", label: "Подсказка под итогами", text: "Промокод не пришёл в ЛС? Забери его здесь.", optional: true },
  joinButton: { group: "Карточка", label: "Кнопка участия", text: "Участвовать", optional: false },
  claimButton: { group: "Карточка", label: "Кнопка получения приза", text: "Получить промокод", optional: false },
  congrats: { group: "Итоги в канале", label: "Поздравление", text: "🎉 Поздравляем {winners} с победой в розыгрыше **{prize}**!", optional: true },
  reroll: { group: "Итоги в канале", label: "Перевыбор победителей", text: "🔁 Новые победители розыгрыша **{prize}**: {winners}", optional: true },
  empty: { group: "Итоги в канале", label: "Розыгрыш без победителей", text: "😔 Розыгрыш **{prize}** завершён без победителей.", optional: true },
  shortage: { group: "Итоги в канале", label: "Призов больше, чем победителей", text: "-# Участников хватило не на все призы.", optional: true },
  delivered: { group: "Итоги в канале", label: "Промокоды доставлены", text: "📩 Промокоды отправлены в личные сообщения.", optional: true },
  failed: { group: "Итоги в канале", label: "ЛС закрыты", text: "⚠️ {winners}, не удалось отправить промокод в ЛС. Нажми «Получить промокод» в карточке.", optional: true },
  dm: { group: "Промокоды", label: "Личное сообщение победителю", text: "Ты выиграл **{prize}**!\nТвой промокод: **{code}**", optional: true },
  organizer: { group: "Промокоды", label: "Отчёт организатору", text: "📋 Промокоды розыгрыша **{prize}** (#{id}):", optional: true },
  claim: { group: "Промокоды", label: "Промокод в канале", text: "## 🎉 Твой промокод\n{prize}\n\n**{code}**", optional: false },
  unavailable: { group: "Промокоды", label: "Код недоступен", text: "Промокод этого розыгрыша недоступен.", optional: false },
  notWinner: { group: "Промокоды", label: "Игрок не выиграл", text: "Ты не в списке победителей этого розыгрыша.", optional: false },
  notAssigned: { group: "Промокоды", label: "Победитель без кода", text: "За тобой сейчас не закреплён промокод. Обратись к организатору.", optional: false },
  claimError: { group: "Промокоды", label: "Ошибка получения", text: "Не удалось показать промокод. Попробуй ещё раз.", optional: false },
  closed: { group: "Участие", label: "Розыгрыш завершён", text: "Этот розыгрыш уже завершён.", optional: false },
  drawing: { group: "Участие", label: "Идёт подведение итогов", text: "Приём заявок закрыт. Подводим итоги.", optional: false },
  needBoost: { group: "Участие", label: "Нужен буст", text: "🚀 Участвовать могут только бустеры сервера **{server}**.", optional: false },
  already: { group: "Участие", label: "Уже участвует", text: "Ты уже участвуешь в розыгрыше **{prize}**. Итоги {relative}.", optional: false },
  joined: { group: "Участие", label: "Участие подтверждено", text: "✅ Ты участвуешь в розыгрыше **{prize}**! Итоги {relative}. Удачи!", optional: false },
  joinedPromo: { group: "Участие", label: "Подсказка после участия", text: "📩 Если победишь, промокод придёт в ЛС. Если ЛС закрыты, забери его кнопкой под итогами.", optional: true },
  left: { group: "Участие", label: "Выход из розыгрыша", text: "Ты больше не участвуешь в розыгрыше **{prize}**.", optional: false },
  leaveButton: { group: "Участие", label: "Кнопка выхода", text: "Покинуть розыгрыш", optional: false },
  rateLimit: { group: "Участие", label: "Слишком частые нажатия", text: "Слишком часто. Подожди пару секунд.", optional: false },
  adminCreated: { group: "Команды организатора", label: "Розыгрыш опубликован", text: "✅ Розыгрыш **#{id}** создан: {url}\nИтоги: **{endsAt}** ({timezone})", optional: false },
  adminQueued: { group: "Команды организатора", label: "Розыгрыш в очереди", text: "✅ Создано {count} промокодов. Розыгрыш **#{id}** появится в канале после публикации ботом.", optional: false },
  adminPublishFailed: { group: "Команды организатора", label: "Ошибка отправки", text: "⚠️ Не удалось отправить сообщение розыгрыша.", optional: false },
  adminCancel: { group: "Команды организатора", label: "Розыгрыш отменён", text: "❌ Розыгрыш **#{id}** ({prize}) отменён.", optional: false },
  adminNoActive: { group: "Команды организатора", label: "Пустой список", text: "Активных розыгрышей нет.", optional: false },
  adminNoReroll: { group: "Команды организатора", label: "Не из кого выбрать", text: "Выбрать некого - все подходящие участники уже побеждали.", optional: false },
  adminBoosters: { group: "Команды организатора", label: "Ограничение по бусту", text: "🚀 Только для бустеров", optional: true },
  adminCodes: { group: "Команды организатора", label: "Коды загружены", text: "🎟 Промокодов загружено: {count}.", optional: true },
  adminEnded: { group: "Команды организатора", label: "Подведение итогов", text: "🏁 Розыгрыш **#{id}** завершён. Победители: {winners}", optional: false },
  adminReroll: { group: "Команды организатора", label: "Новые победители", text: "🔁 Новые победители: {winners}", optional: false },
  adminCodesShort: { group: "Команды организатора", label: "Не хватило кодов", text: "⚠️ Свободных промокодов хватило не всем новым победителям.", optional: false },
  resendButton: { group: "Команды организатора", label: "Повторная отправка ЛС", text: "Отправить недоставленные ещё раз", optional: false },
  retryButton: { group: "Команды организатора", label: "Исправление списка кодов", text: "Исправить промокоды", optional: false },
  badChannel: { group: "Команды организатора", label: "Неподходящий канал", text: "Здесь нельзя создать розыгрыш - укажи текстовый канал в параметре «канал».", optional: false },
  missingPermissions: { group: "Команды организатора", label: "Недостаточно прав", text: "У бота не хватает прав в {channel}: {permissions}.", optional: false },
  draftExpired: { group: "Команды организатора", label: "Прошло время создания", text: "Пока вводились промокоды, время итогов уже прошло. Создай розыгрыш заново.", optional: false },
  badDate: { group: "Команды организатора", label: "Неверная дата", text: "Не понял дату «{value}». Формат: ДД.ММ.ГГГГ, например 30.09.2026", optional: false },
  badTime: { group: "Команды организатора", label: "Неверное время", text: "Не понял время «{value}». Формат: ЧЧ:ММ, например 20:00", optional: false },
  pastEnd: { group: "Команды организатора", label: "Итоги в прошлом", text: "Время итогов должно быть в будущем. Сейчас {time} ({timezone}).", optional: false },
  tooLong: { group: "Команды организатора", label: "Слишком большая длительность", text: "Розыгрыш не может длиться дольше года.", optional: false },
  quickExpired: { group: "Команды организатора", label: "Время быстрого розыгрыша прошло", text: "Время итогов быстрого розыгрыша ({time}) уже прошло. Поменяй его в панели или создай розыгрыш через «создать».", optional: false },
  quickSaveFailed: { group: "Команды организатора", label: "Сбой после создания кодов", text: "Промокоды созданы. Проверь розыгрыш в панели и последние промокоды в магазине перед повтором команды.", optional: false },
  missingActive: { group: "Команды организатора", label: "Активный розыгрыш не найден", text: "Активный розыгрыш с таким номером не найден.", optional: false },
  notPublished: { group: "Команды организатора", label: "Публикация ещё не состоялась", text: "Этот розыгрыш ещё не опубликован в канале.", optional: false },
  missingEnded: { group: "Команды организатора", label: "Завершённый розыгрыш не найден", text: "Завершённый розыгрыш с таким номером не найден.", optional: false },
  missingPromo: { group: "Команды организатора", label: "Розыгрыш с кодами не найден", text: "Розыгрыш с промокодами с таким номером не найден.", optional: false },
  missingGiveaway: { group: "Команды организатора", label: "Розыгрыш не найден", text: "Розыгрыш не найден.", optional: false },
  staleForm: { group: "Команды организатора", label: "Окно устарело", text: "Окно устарело. Создай розыгрыш заново.", optional: false },
  otherOwner: { group: "Команды организатора", label: "Чужое меню", text: "Это меню открыл другой человек.", optional: false },
  genericError: { group: "Команды организатора", label: "Общая ошибка", text: "Что-то пошло не так. Подробности в истории бота в панели.", optional: false },
  listTitle: { group: "Команды организатора", label: "Заголовок списка активных розыгрышей", text: "🎁 Активные розыгрыши", optional: false },
} as const;

export type GiveawayMessageKey = keyof typeof GIVEAWAY_MESSAGES;
export type GiveawayMessageSettings = { messages: unknown; promoDmText: string };

export function giveawayMessageSupportsEmbed(key: GiveawayMessageKey): boolean {
  return ["congrats", "reroll", "empty", "dm", "organizer", "joined", "already", "closed", "drawing", "needBoost", "left"].includes(key);
}

export function giveawayMessageLength(key: GiveawayMessageKey): number {
  return key.endsWith("Button") ? 80 : key === "listTitle" ? 256 : 1700;
}

export function giveawayMessageConfig(settings: GiveawayMessageSettings, key: GiveawayMessageKey) {
  const def = GIVEAWAY_MESSAGES[key];
  const raw = settings.messages && typeof settings.messages === "object"
    ? (settings.messages as Record<string, unknown>)[key] : null;
  const saved = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  return {
    text: typeof saved?.text === "string" && saved.text.trim() ? saved.text : key === "dm" ? settings.promoDmText : def.text,
    enabled: !def.optional || saved?.enabled !== false,
    format: giveawayMessageSupportsEmbed(key) && saved?.format === "embed" ? "embed" as const : "plain" as const,
    title: typeof saved?.title === "string" ? saved.title.slice(0, 256) : "",
    color: typeof saved?.color === "string" && /^#[0-9a-f]{6}$/i.test(saved.color) ? saved.color : "#ff5a1f",
    footer: typeof saved?.footer === "string" ? saved.footer.slice(0, 256) : "",
  };
}

export function giveawayMessage(settings: GiveawayMessageSettings, key: GiveawayMessageKey, vars: Record<string, string | number> = {}): string {
  const cfg = giveawayMessageConfig(settings, key);
  return cfg.enabled ? renderTemplate(cfg.text, vars).slice(0, key.endsWith("Button") ? 80 : 2000) : "";
}
