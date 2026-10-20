// Подставляет {name} из vars. Неизвестные плейсхолдеры остаются как есть.
// Экранирование значений (markdown, упоминания) делает вызывающий код.
export function renderTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

export function startOfUtcDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const nf = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 });

// 1 245, 0,01, 12 480,5 — до двух знаков после запятой, лишние нули не показываются.
export function formatNumber(n: number): string {
  return nf.format(n);
}

export function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
