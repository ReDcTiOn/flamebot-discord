import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { NoticeRule } from "@prisma/client";
import {
  DEFAULT_NOTICE_RULES,
  buildPromoSpec,
  fmtPromoEnd,
  noticeKey,
  noticeRuleProblems,
  noticeSecretHint,
  noticeSecretProblem,
  noticeSettingsSchema,
  noticeWipeOn,
  noticeWipesBetween,
  parseTimes,
  parseVkPhoto,
  renderNotice,
} from "../src/notices.js";

const TZ = "Europe/Moscow";
const rules: NoticeRule[] = DEFAULT_NOTICE_RULES.map((r) => ({
  regularTemplateId: null,
  globalTemplateId: null,
  enabled: true,
  forceTimezone: null,
  forceTime: null,
  bpFirstOfMonth: false,
  bpEveryDays: 0,
  bpAnchor: null,
  updatedAt: new Date(),
  ...(r as Omit<NoticeRule, "updatedAt">),
}));
const msk = (iso: string) => new Date(`${iso}+03:00`);

describe("объявления о вайпах: расписание", () => {
  it("неделя как у прежнего бота", () => {
    const w = noticeWipesBetween(rules, TZ, msk("2026-10-19T00:00"), msk("2026-10-25T23:59"));
    assert.deepEqual(
      w.map((x) => `${x.key} ${x.kind}`),
      ["2026-10-20T14:00 regular", "2026-10-22T17:00 regular", "2026-10-23T14:00 regular"],
    );
  });

  it("первый четверг — форс-вайп по Нью-Йорку, летом 21:00, зимой 22:00 МСК", () => {
    assert.equal(noticeWipeOn(rules, TZ, { year: 2026, month: 10, day: 1 })!.key, "2026-10-01T21:00");
    const nov = noticeWipeOn(rules, TZ, { year: 2026, month: 11, day: 5 })!;
    assert.equal(nov.key, "2026-11-05T22:00");
    assert.equal(nov.kind, "global");
  });

  it("глобальная пятница раз в две недели от 2 октября", () => {
    const kinds = ["2026-10-02", "2026-10-09", "2026-10-16", "2026-10-30"].map((d) => {
      const [y, m, day] = d.split("-").map(Number);
      return noticeWipeOn(rules, TZ, { year: y!, month: m!, day: day! })!.kind;
    });
    assert.deepEqual(kinds, ["global", "regular", "global", "global"]);
  });

  it("границы окна включаются, выключенные правила пропускаются", () => {
    assert.equal(noticeWipesBetween(rules, TZ, msk("2026-10-20T14:00"), msk("2026-10-20T14:00")).length, 1);
    const off = rules.map((r) => (r.key === "tuesday" ? { ...r, enabled: false } : r));
    assert.equal(noticeWipesBetween(off, TZ, msk("2026-10-20T00:00"), msk("2026-10-20T23:00")).length, 0);
  });

  it("ключ события — местное время", () => {
    assert.equal(noticeKey(new Date("2026-10-20T11:00:00Z"), TZ), "2026-10-20T14:00");
  });
});

describe("объявления о вайпах: тексты и промокод", () => {
  it("подстановки во всех строках вебхука и в тексте ВКонтакте", () => {
    const r = renderNotice(
      { discord: { content: "@everyone", embeds: [{ title: "Вайп {weekday}", description: "{date} в {time}, <t:{ts}:R>", color: 1 }] }, vk: "Вайп {date} {time}" },
      msk("2026-10-23T14:00"),
      TZ,
    );
    const embed = (r.discord.embeds as { title: string; description: string; color: number }[])[0]!;
    assert.equal(embed.title, "Вайп пятница");
    assert.equal(embed.description, `23.10 в 14:00, <t:${msk("2026-10-23T14:00").getTime() / 1000}:R>`);
    assert.equal(embed.color, 1);
    assert.equal(r.vk, "Вайп 23.10 14:00");
  });

  it("промокод действует до конца следующего дня", () => {
    const s = { promoCode: "FLAMEWIPE", promoType: "discount", promoDaysAfter: 1, promoEndTime: "23:59", promoLimitUses: 0, timezone: TZ };
    const spec = buildPromoSpec(s, 30, msk("2026-10-20T14:00"));
    assert.deepEqual(spec, { code: "FLAMEWIPE", type: "discount", amount: 30, dateEnd: "2026-10-21 23:59", limitUses: 0 });
    // Вайп в 22:00 МСК в последний день месяца: срок — 1-е число по МСК, а не по UTC.
    assert.equal(buildPromoSpec(s, 50, msk("2026-10-31T22:00")).dateEnd, "2026-11-01 23:59");
    assert.equal(fmtPromoEnd("2026-10-24 23:59"), "Сб 24.10 23:59");
  });
});

describe("объявления о вайпах: проверка полей", () => {
  const templates = [
    { id: "tue", kind: "regular" },
    { id: "glob", kind: "global" },
  ];

  it("правилу нужны тексты для тех типов вайпа, что по нему бывают", () => {
    assert.deepEqual(noticeRuleProblems({ bpFirstOfMonth: false, bpEveryDays: 0, regularTemplateId: "tue", globalTemplateId: null }, templates), []);
    assert.deepEqual(noticeRuleProblems({ bpFirstOfMonth: true, bpEveryDays: 0, regularTemplateId: "tue", globalTemplateId: null }, templates), ["Не выбран текст для глобального вайпа"]);
    assert.deepEqual(noticeRuleProblems({ bpFirstOfMonth: false, bpEveryDays: 0, regularTemplateId: "glob", globalTemplateId: null }, templates), ["Текст «glob» для другого типа вайпа"]);
    assert.deepEqual(noticeRuleProblems({ bpFirstOfMonth: false, bpEveryDays: 0, regularTemplateId: "gone", globalTemplateId: null }, templates), ["Текста «gone» нет"]);
  });

  it("фото ВКонтакте из ссылки и время через запятую", () => {
    assert.equal(parseVkPhoto("https://vk.com/photo-123456_789?list=x"), "photo-123456_789");
    assert.equal(parseVkPhoto("что-то"), null);
    assert.deepEqual(parseTimes("14:00, 9:5 15:00"), ["14:00", "09:05", "15:00"]);
  });

  it("напоминание о подтверждении — позже первого сообщения", () => {
    const base = {
      timezone: TZ, timezoneLabel: "МСК", notifyMinutes: 600, remindMinutes: 60, maxLateMinutes: 30, dryRun: false, telegramAdminIds: ["1"],
      vkGroupId: 1, vkPhotoRegular: null, vkPhotoGlobal: null, testVkGroupId: null, testVkPhotoRegular: null, testVkPhotoGlobal: null,
      gamestoresStoreId: null, promoCode: "FLAMEWIPE", promoType: "discount", promoDaysAfter: 1, promoEndTime: "23:59", promoLimitUses: 0,
      promoTestReal: false, agendaEnabled: true, agendaSendAt: "5:00", agendaGraceMinutes: 240, agendaGreeting: "Доброе утро!",
    };
    const ok = noticeSettingsSchema.parse(base);
    assert.equal(ok.agendaSendAt, "05:00");
    assert.ok(!noticeSettingsSchema.safeParse({ ...base, remindMinutes: 700 }).success);
  });

  it("ключи: формат и подсказка без секрета", () => {
    const webhook = `https://discord.com/api/webhooks/100000000000000001/${"w".repeat(30)}abcd`;
    assert.equal(noticeSecretProblem("discordWebhook", webhook), null);
    assert.equal(noticeSecretHint("discordWebhook", webhook), "…/webhooks/100000000000000001/…abcd");
    assert.ok(noticeSecretProblem("discordWebhook", "https://example.com/hook"));
    assert.ok(noticeSecretProblem("vkToken", "short"));
    assert.equal(noticeSecretHint("vkToken", `vk1.a.${"v".repeat(50)}wxyz`), "…wxyz");
  });
});
