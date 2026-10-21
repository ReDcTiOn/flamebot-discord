import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_MAPS_RULES,
  DEFAULT_MAPS_SERVERS,
  fmtWipe,
  isBlueprintWipe,
  isStagingWipe,
  mapsRuleProblems,
  mapsSecretHint,
  mapsSecretProblem,
  renderMapsTemplate,
  templateServerIds,
  upcomingWipes,
  type MapsRuleLike,
} from "../src/maps.js";
import { DEFAULT_SCORING, monumentChecklist, resolveScoring, scorePool } from "../src/mapsScoring.js";

const rules: MapsRuleLike[] = DEFAULT_MAPS_RULES.map((r) => ({
  key: r.key,
  weekday: r.weekday,
  time: r.time,
  serverIds: r.serverIds as number[],
  pool: r.pool,
  template: r.template,
  forceTimezone: r.forceTimezone ?? null,
  forceTime: r.forceTime ?? null,
  bpFirstOfMonth: r.bpFirstOfMonth ?? false,
  bpEveryDays: r.bpEveryDays ?? 0,
  bpAnchor: (r.bpAnchor as Date | undefined) ?? null,
  enabled: true,
}));
const TZ = "Europe/Moscow";

describe("карты: расписание вайпов", () => {
  it("находит ближайшие вайпы по правилам", () => {
    const wipes = upcomingWipes(rules, TZ, new Date("2026-10-19T12:00:00Z"));
    assert.deepEqual(
      wipes.slice(0, 4).map((w) => [w.id, w.wipeAt.toISOString()]),
      [
        ["tuesday-2026-10-20", "2026-10-20T11:00:00.000Z"],
        ["thursday-2026-10-22", "2026-10-22T14:00:00.000Z"],
        ["friday-2026-10-23", "2026-10-23T11:00:00.000Z"],
        ["tuesday-2026-10-27", "2026-10-27T11:00:00.000Z"],
      ],
    );
  });

  it("в первую неделю месяца берёт время форс-вайпа по Нью-Йорку", () => {
    const w = upcomingWipes(rules, TZ, new Date("2026-09-30T00:00:00Z")).find((x) => x.id === "thursday-2026-10-01");
    // 14:00 в Нью-Йорке летом — 18:00 UTC, то есть 21:00 МСК.
    assert.equal(w?.wipeAt.toISOString(), "2026-10-01T18:00:00.000Z");
    assert.equal(fmtWipe(w!.wipeAt, TZ, "МСК"), "чт 01.10 21:00 МСК");
  });

  it("отмечает staging и глобальные вайпы", () => {
    const thursday = rules.find((r) => r.key === "thursday")!;
    const friday = rules.find((r) => r.key === "friday")!;
    assert.equal(isStagingWipe(new Date("2026-10-01T18:00:00Z"), TZ), true);
    assert.equal(isStagingWipe(new Date("2026-10-02T11:00:00Z"), TZ), true);
    assert.equal(isStagingWipe(new Date("2026-10-09T11:00:00Z"), TZ), false);
    assert.equal(isBlueprintWipe(thursday, new Date("2026-10-01T18:00:00Z"), TZ), true);
    assert.equal(isBlueprintWipe(thursday, new Date("2026-10-08T14:00:00Z"), TZ), false);
    assert.equal(isBlueprintWipe(friday, new Date("2026-10-16T11:00:00Z"), TZ), true);
    assert.equal(isBlueprintWipe(friday, new Date("2026-10-23T11:00:00Z"), TZ), false);
    assert.equal(isBlueprintWipe(friday, new Date("2026-09-18T11:00:00Z"), TZ), true);
  });
});

describe("карты: шаблоны и правила", () => {
  it("стартовые правила согласованы с серверами", () => {
    for (const r of rules) assert.deepEqual(mapsRuleProblems(r, DEFAULT_MAPS_SERVERS), [], r.key);
  });

  it("находит несогласованное правило", () => {
    const r = { ...rules[0]!, pool: { "4000_Modded": 1, "9999_X": 2 } };
    const problems = mapsRuleProblems(r, DEFAULT_MAPS_SERVERS);
    assert.ok(problems.some((p) => p.includes("4000_Modded")));
    assert.ok(problems.some((p) => p.includes("3500_Modded")));
    assert.ok(problems.some((p) => p.includes("9999_X")));
  });

  it("подставляет ссылки в шаблон анонса", () => {
    const t = { embeds: [{ description: "[a]({view:5}) [b]({download:5})" }] };
    assert.deepEqual(templateServerIds(t), [5]);
    assert.deepEqual(renderMapsTemplate(t, { 5: { view: "V", download: "D" } }), { embeds: [{ description: "[a](V) [b](D)" }] });
    assert.throws(() => renderMapsTemplate(t, {}), /сервер 5/);
  });

  it("проверяет секреты и не раскрывает их в подсказке", () => {
    assert.equal(mapsSecretProblem("pteroApiKey", "ptla_" + "x".repeat(43)) !== null, true);
    assert.equal(mapsSecretProblem("pteroApiKey", "ptlc_" + "x".repeat(43)), null);
    assert.equal(mapsSecretProblem("telegramToken", "123456789:" + "A".repeat(35)), null);
    const hook = "https://discord.com/api/webhooks/123456789012345678/" + "s".repeat(60) + "WXYZ";
    assert.equal(mapsSecretProblem("discordWebhook", hook), null);
    assert.equal(mapsSecretHint("discordWebhook", hook), "…/webhooks/123456789012345678/…WXYZ");
  });
});

describe("карты: оценка для автоподбора", () => {
  const map = (types: string[], extra: Record<string, number> = {}) => ({
    monuments: types.map((type, i) => ({ type, coordinates: { x: (i % 2 ? 1 : -1) * 500 * (i + 1), y: (i % 3 ? 1 : -1) * 400 * (i + 1) } })),
    ...extra,
  });

  it("карта с топовыми РТ оценивается выше", () => {
    const rich = map(["Launch Site", "Military Tunnels", "Airfield", "Powerplant", "Trainyard", "Outpost"], { landPercentageOfMap: 60 });
    const poor = map(["Junkyard", "Radtown"], { landPercentageOfMap: 40 });
    const [a, b] = scorePool([rich, poor], 4000);
    assert.ok(a!.total > b!.total);
    assert.equal(a!.of, 22);
    assert.ok(b!.missing[0] === "Космодром" || b!.missing[0] === "Военные туннели");
  });

  it("чек-лист и битые настройки оценки", () => {
    assert.equal(monumentChecklist([{ type: "Military Base C" }]).find((r) => r.name === "Военная база")?.present, true);
    assert.deepEqual(resolveScoring({ parts: { rt: 90, spread: 90, terrain: 0, extra: 0 } }), DEFAULT_SCORING);
  });
});
