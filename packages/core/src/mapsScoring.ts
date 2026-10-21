import { z } from "zod";

// Чек-лист РТ и оценка карт для автоподбора (0–100). Чистые функции: данные берутся из ответа
// RustMaps (info карты), поэтому одинаково считаются в боте и в панели.
//
// Из чего складывается оценка (веса настраиваются в панели):
//   • РТ из списка с учётом популярности (по умолчанию 50 баллов). Нет редкой малопопулярной РТ —
//     теряется мало, нет космодрома — много.
//   • Расстановка крупных РТ (20): охват четвертей карты, нет ли крупных РТ вплотную друг к другу,
//     не стоят ли безопасные зоны (аванпост, бандитский город) вплотную к топовым РТ.
//   • Рельеф (20): суша, «скальные» места под базы, реки и озёра — относительно остальных карт пула
//     (в абсолютных числах хорошие значения зависят от размера карты).
//   • Насыщенность (10): общее число монументов относительно остальных карт пула.
// Биомы не оцениваются: их доли задаёт сохранённый конфиг RustMaps.

// РТ для карточки карты, как на странице карты в RustMaps: (название, типы монументов из API).
// РТ есть на карте, если есть хотя бы один из типов. Порядок — порядок в карточке.
export const MONUMENT_CHECKLIST: readonly (readonly [string, readonly string[]])[] = [
  ["Аэродром", ["Airfield"]],
  ["Свалка", ["Junkyard"]],
  ["Космодром", ["Launch Site"]],
  ["Военные туннели", ["Military Tunnels"]],
  ["Ракетная шахта", ["Nuclear Missile Silo"]],
  ["Электростанция", ["Powerplant"]],
  ["Ж/Д депо", ["Trainyard"]],
  ["Паромный терминал", ["Ferry Terminal"]],
  ["Очистные сооружения", ["Water Treatment"]],
  ["Сферический резервуар", ["Sphere Tank"]],
  ["Бандитский город", ["Bandit Town"]],
  ["Канализационная ветка", ["Sewer Branch"]],
  ["Спутниковая тарелка", ["Satellite Dish"]],
  ["Аванпост", ["Outpost"]],
  ["Экскаватор", ["Excavator"]],
  ["Большая нефтяная вышка", ["Large Oilrig"]],
  ["Малая нефтяная вышка", ["Small Oilrig"]],
  ["Арктическая база", ["Arctic Research Base A"]],
  ["Радтаун", ["Radtown"]],
  ["Жилой комплекс", ["Apartments Complex"]],
  ["Зиккурат", ["Ziggurat"]],
  ["Военная база", ["Military Base A", "Military Base B", "Military Base C", "Military Base D"]],
];

// Вес РТ (1–10): популярность и ценность для игроков.
export const DEFAULT_RT_WEIGHTS: Record<string, number> = {
  Космодром: 10,
  "Военные туннели": 10,
  Аэродром: 9,
  "Ж/Д депо": 8,
  Электростанция: 8,
  "Очистные сооружения": 8,
  "Большая нефтяная вышка": 8,
  Аванпост: 8,
  "Ракетная шахта": 7,
  "Сферический резервуар": 7,
  "Малая нефтяная вышка": 6,
  "Спутниковая тарелка": 6,
  Экскаватор: 6,
  "Арктическая база": 6,
  "Канализационная ветка": 6,
  "Бандитский город": 6,
  "Военная база": 4,
  "Паромный терминал": 4,
  Свалка: 3,
  Зиккурат: 3,
  Радтаун: 3,
  "Жилой комплекс": 3,
};

const weight = z.number().int().min(0).max(10);

export const mapsScoringSchema = z
  .object({
    // Баллы по составляющим, в сумме 100.
    parts: z.object({
      rt: z.number().int().min(0).max(100),
      spread: z.number().int().min(0).max(100),
      terrain: z.number().int().min(0).max(100),
      extra: z.number().int().min(0).max(100),
    }),
    rtWeights: z.record(z.string(), weight),
  })
  .refine((s) => s.parts.rt + s.parts.spread + s.parts.terrain + s.parts.extra === 100, {
    message: "Баллы составляющих оценки должны давать в сумме 100",
    path: ["parts"],
  });

export type MapsScoring = z.infer<typeof mapsScoringSchema>;

export const DEFAULT_SCORING: MapsScoring = {
  parts: { rt: 50, spread: 20, terrain: 20, extra: 10 },
  rtWeights: DEFAULT_RT_WEIGHTS,
};

// Настройки из базы. Битые или старые значения не ломают бота: берутся значения по умолчанию,
// а для РТ без веса — вес по умолчанию.
export function resolveScoring(raw: unknown): MapsScoring {
  const parsed = mapsScoringSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_SCORING;
  return { parts: parsed.data.parts, rtWeights: { ...DEFAULT_RT_WEIGHTS, ...parsed.data.rtWeights } };
}

// Пороги расстановки как доля размера карты.
const MIN_GAP = 0.05; // крупные РТ ближе этого считаются «слипшимися» (≈200 м на карте 4000)
const SAFE_GAP = 0.07; // безопасная зона ближе этого к топовой РТ портит баланс (≈280 м на карте 4000)
const BIG_WEIGHT = 6; // РТ с таким весом и выше считаются крупными
const TOP_WEIGHT = 8; // топовые РТ (лут и PvP)
const SAFE_ZONES = new Set(["Outpost", "Bandit Town"]);
const OFFSHORE = new Set(["Large Oilrig", "Small Oilrig"]); // вышки в море в расстановку не входят

export interface Monument {
  type?: string;
  coordinates?: { x?: number | null; y?: number | null } | null;
}

export interface MapInfo {
  monuments?: Monument[] | null;
  totalMonuments?: number | null;
  landPercentageOfMap?: number | null;
  buildableRocks?: number | null;
  rivers?: number | null;
  lakes?: number | null;
  [key: string]: unknown;
}

export interface MapScore {
  total: number;
  rt: number;
  spread: number;
  terrain: number;
  extra: number;
  present: number; // сколько РТ из списка есть на карте
  of: number; // сколько РТ в списке
  missing: string[]; // отсутствующие значимые РТ (вес от 6), самые ценные первыми
}

const types = (monuments: Monument[] | null | undefined) => new Set((monuments ?? []).map((m) => String(m.type ?? "").trim().toLowerCase()));

export interface ChecklistRow {
  name: string;
  present: boolean;
}

export function monumentChecklist(monuments: Monument[] | null | undefined): ChecklistRow[] {
  const have = types(monuments);
  return MONUMENT_CHECKLIST.map(([name, kinds]) => ({ name, present: kinds.some((t) => have.has(t.toLowerCase())) }));
}

function rtPart(monuments: Monument[] | null | undefined, weights: Record<string, number>): [number, number, string[]] {
  let got = 0;
  let total = 0;
  const missing: [number, string][] = [];
  const rows = monumentChecklist(monuments);
  for (const { name, present } of rows) {
    const w = weights[name] ?? 0;
    total += w;
    if (present) got += w;
    else if (w >= BIG_WEIGHT) missing.push([w, name]);
  }
  missing.sort((a, b) => b[0] - a[0]);
  return [total ? got / total : 0, rows.filter((r) => r.present).length, missing.map(([, n]) => n)];
}

function points(monuments: Monument[] | null | undefined, kinds: Set<string>): [number, number][] {
  const out: [number, number][] = [];
  for (const m of monuments ?? []) {
    const c = m.coordinates;
    if (kinds.has(String(m.type ?? "")) && c && c.x != null && c.y != null) out.push([Number(c.x), Number(c.y)]);
  }
  return out;
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Расстановка крупных РТ, 0..1. Без координат или при малом числе РТ — нейтральные 0.5.
function spreadPart(monuments: Monument[] | null | undefined, size: number, weights: Record<string, number>): number {
  const byType = new Map<string, number>();
  for (const [name, kinds] of MONUMENT_CHECKLIST) for (const t of kinds) byType.set(t, weights[name] ?? 0);
  const big = new Set([...byType].filter(([t, w]) => w >= BIG_WEIGHT && !OFFSHORE.has(t)).map(([t]) => t));
  const top = new Set([...byType].filter(([t, w]) => w >= TOP_WEIGHT && !OFFSHORE.has(t)).map(([t]) => t));
  const pts = points(monuments, big);
  if (pts.length < 3 || size <= 0) return 0.5;

  const quads = new Set(pts.map(([x, y]) => `${x >= 0}:${y >= 0}`));
  const cover = quads.size / 4;
  const gap = MIN_GAP * size;
  const ok = pts.filter((p, i) => Math.min(...pts.filter((_, j) => j !== i).map((q) => dist(p, q))) >= gap).length;
  const clump = ok / pts.length;
  const safe = points(monuments, SAFE_ZONES);
  const tops = points(monuments, top);
  let safeOk = 0.5;
  if (safe.length && tops.length) {
    const pairs = safe.flatMap((s) => tops.map((t) => dist(s, t) >= SAFE_GAP * size));
    safeOk = pairs.filter(Boolean).length / pairs.length;
  }
  return 0.4 * cover + 0.35 * clump + 0.25 * safeOk;
}

// Положение каждого значения среди остальных, 0..1 (одинаковые делят место). Для одного значения 0.5.
function percentiles(values: number[]): number[] {
  const n = values.length;
  if (n < 2) return values.map(() => 0.5);
  return values.map((v) => (values.filter((x) => x < v).length + 0.5 * (values.filter((x) => x === v).length - 1)) / (n - 1));
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round1 = (n: number) => Math.round(n * 10) / 10;

// Оценки всех карт пула: рельеф и насыщенность сравниваются между картами пула.
export function scorePool(infos: MapInfo[], size: number, scoring: MapsScoring = DEFAULT_SCORING): MapScore[] {
  const { parts, rtWeights } = scoring;
  const land = percentiles(infos.map((i) => num(i.landPercentageOfMap)));
  const rocks = percentiles(infos.map((i) => num(i.buildableRocks)));
  const water = percentiles(infos.map((i) => num(i.rivers) + num(i.lakes)));
  const count = percentiles(infos.map((i) => num(i.totalMonuments) || (i.monuments ?? []).length));
  return infos.map((info, k) => {
    const [share, present, missing] = rtPart(info.monuments, rtWeights);
    const rt = parts.rt * share;
    const spread = parts.spread * spreadPart(info.monuments, size, rtWeights);
    const terrain = (parts.terrain * (land[k]! + rocks[k]! + water[k]!)) / 3;
    const extra = parts.extra * count[k]!;
    return {
      total: round1(rt + spread + terrain + extra),
      rt: round1(rt),
      spread: round1(spread),
      terrain: round1(terrain),
      extra: round1(extra),
      present,
      of: MONUMENT_CHECKLIST.length,
      missing,
    };
  });
}
