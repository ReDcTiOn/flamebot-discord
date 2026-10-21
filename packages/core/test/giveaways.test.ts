import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  formatInZone,
  giveawaySettingsSchema,
  parseCodes,
  parseDate,
  parseTime,
  plural,
  today,
  weekday,
  zonedParts,
  zonedToDate,
} from "../src/giveaways.js";

const now = { year: 2026, month: 10, day: 21 };

describe("розыгрыши: дата и время", () => {
  it("понимает разные записи даты", () => {
    assert.deepEqual(parseDate("30.10.2026", now), { year: 2026, month: 10, day: 30 });
    assert.deepEqual(parseDate("30.10.26", now), { year: 2026, month: 10, day: 30 });
    assert.deepEqual(parseDate("30/10", now), { year: 2026, month: 10, day: 30 });
    assert.deepEqual(parseDate("21.10", now), { year: 2026, month: 10, day: 21 });
    // Прошедшее число без года — ближайшее в будущем, то есть в следующем году.
    assert.deepEqual(parseDate("01.02", now), { year: 2027, month: 2, day: 1 });
    // Подпись из подсказки после даты не мешает.
    assert.deepEqual(parseDate("30.10.2026, чт", now), { year: 2026, month: 10, day: 30 });
  });

  it("отвергает несуществующие даты", () => {
    assert.equal(parseDate("31.02.2027", now), null);
    assert.equal(parseDate("завтра", now), null);
    assert.equal(parseDate("", now), null);
    assert.equal(parseDate("30", now), null);
  });

  it("понимает разные записи времени", () => {
    assert.deepEqual(parseTime("20:00"), { hour: 20, minute: 0 });
    assert.deepEqual(parseTime("20.30"), { hour: 20, minute: 30 });
    assert.deepEqual(parseTime("20 15"), { hour: 20, minute: 15 });
    assert.deepEqual(parseTime("2045"), { hour: 20, minute: 45 });
    assert.deepEqual(parseTime("930"), { hour: 9, minute: 30 });
    assert.deepEqual(parseTime("9"), { hour: 9, minute: 0 });
    assert.deepEqual(parseTime("20:"), { hour: 20, minute: 0 });
    assert.equal(parseTime("24:00"), null);
    assert.equal(parseTime("20:60"), null);
    assert.equal(parseTime("вечер"), null);
  });

  it("переводит время Владивостока в UTC", () => {
    const d = zonedToDate({ year: 2026, month: 10, day: 21 }, { hour: 23, minute: 0 }, "Asia/Vladivostok");
    assert.equal(d.toISOString(), "2026-10-21T13:00:00.000Z");
    assert.equal(formatInZone(d, "Asia/Vladivostok"), "21.10.2026 23:00");
    assert.deepEqual(today("Asia/Vladivostok", new Date("2026-10-21T15:00:00Z")), { year: 2026, month: 10, day: 22 });
  });

  it("учитывает переход на летнее время", () => {
    const winter = zonedToDate({ year: 2026, month: 1, day: 15 }, { hour: 12, minute: 0 }, "Europe/Berlin");
    const summer = zonedToDate({ year: 2026, month: 7, day: 15 }, { hour: 12, minute: 0 }, "Europe/Berlin");
    assert.equal(winter.toISOString(), "2026-01-15T11:00:00.000Z");
    assert.equal(summer.toISOString(), "2026-07-15T10:00:00.000Z");
    assert.equal(zonedParts(summer, "Europe/Berlin").hour, 12);
  });

  it("считает дни и дни недели", () => {
    assert.deepEqual(addDays({ year: 2026, month: 12, day: 31 }, 1), { year: 2027, month: 1, day: 1 });
    assert.equal(weekday({ year: 2026, month: 10, day: 21 }), 2); // среда
  });
});

describe("розыгрыши: тексты и настройки", () => {
  it("склоняет слова", () => {
    assert.equal(plural(1, "промокод", "промокода", "промокодов"), "промокод");
    assert.equal(plural(3, "промокод", "промокода", "промокодов"), "промокода");
    assert.equal(plural(5, "промокод", "промокода", "промокодов"), "промокодов");
    assert.equal(plural(12, "промокод", "промокода", "промокодов"), "промокодов");
    assert.equal(plural(21, "промокод", "промокода", "промокодов"), "промокод");
  });

  it("разбирает промокоды столбиком", () => {
    assert.deepEqual(parseCodes("  A1 \r\n\nB2\n  \nC3"), ["A1", "B2", "C3"]);
  });

  it("проверяет настройки", () => {
    const base = {
      timezone: "Asia/Vladivostok",
      timezoneLabel: "Владивосток",
      promoDmText: "Твой промокод: {code}",
      quickPrize: "Промокод",
      quickWinners: 5,
      quickDaysAhead: 1,
      quickTime: "2300",
      quickBoostersOnly: false,
    };
    assert.equal(giveawaySettingsSchema.parse(base).quickTime, "23:00");
    assert.equal(giveawaySettingsSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success, false);
    assert.equal(giveawaySettingsSchema.safeParse({ ...base, promoDmText: "Без кода" }).success, false);
    assert.equal(giveawaySettingsSchema.safeParse({ ...base, quickTime: "25:00" }).success, false);
  });
});
