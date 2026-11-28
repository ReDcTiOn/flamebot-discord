import type { ReactNode } from "react";

// Превью разметки Discord без вставки HTML: заголовки, мелкий текст, списки, цитаты,
// **жирный**, *курсив*, __подчёркнутый__, ~~зачёркнутый~~, ||спойлер||, `код`, ссылки,
// метки времени <t:…>, упоминания и эмодзи сервера. Время — в поясе панели, чтобы сервер и браузер совпадали.

const INLINE =
  /\*\*(.+?)\*\*|__(.+?)__|\*(.+?)\*|_(.+?)_|~~(.+?)~~|\|\|(.+?)\|\||`([^`]+)`|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)|<t:(\d+)(?::([tTdDfFR]))?>|<@!?(\d+)>|<@&(\d+)>|<#(\d+)>|<a?:(\w+):\d+>|@(everyone|here)/g;

export interface DiscordContext {
  timeZone: string;
  now: number;
  users?: Record<string, string>;
}

function stamp(sec: number, style: string, ctx: DiscordContext): string {
  const d = new Date(sec * 1000);
  const tz = { timeZone: ctx.timeZone };
  switch (style) {
    case "t":
      return d.toLocaleTimeString("ru-RU", { ...tz, hour: "2-digit", minute: "2-digit" });
    case "T":
      return d.toLocaleTimeString("ru-RU", tz);
    case "d":
      return d.toLocaleDateString("ru-RU", tz);
    case "D":
      return d.toLocaleDateString("ru-RU", { ...tz, day: "numeric", month: "long", year: "numeric" });
    case "F":
      return d.toLocaleString("ru-RU", { ...tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    case "R": {
      const diff = sec * 1000 - ctx.now;
      const abs = Math.abs(diff);
      const rtf = new Intl.RelativeTimeFormat("ru", { numeric: "always" });
      if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
      if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
      return rtf.format(Math.round(diff / 86_400_000), "day");
    }
    default:
      return d.toLocaleString("ru-RU", { ...tz, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
}

function inline(text: string, ctx: DiscordContext, keyBase = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}${n++}`;
    if (m[1] !== undefined) out.push(<b key={k}>{inline(m[1], ctx, `${k}.`)}</b>);
    else if (m[2] !== undefined) out.push(<u key={k}>{inline(m[2], ctx, `${k}.`)}</u>);
    else if (m[3] !== undefined || m[4] !== undefined) out.push(<i key={k}>{inline((m[3] ?? m[4])!, ctx, `${k}.`)}</i>);
    else if (m[5] !== undefined) out.push(<s key={k}>{inline(m[5], ctx, `${k}.`)}</s>);
    else if (m[6] !== undefined) out.push(<span key={k} className="dc-spoiler">{inline(m[6], ctx, `${k}.`)}</span>);
    else if (m[7] !== undefined) out.push(<code key={k} className="dc-code">{m[7]}</code>);
    else if (m[8] !== undefined) out.push(<span key={k} className="dc-link" title={m[9]}>{m[8]}</span>);
    else if (m[10] !== undefined) out.push(<span key={k} className="dc-time">{stamp(Number(m[10]), m[11] ?? "f", ctx)}</span>);
    else if (m[12] !== undefined) out.push(<span key={k} className="dc-ping">@{ctx.users?.[m[12]] ?? "игрок"}</span>);
    else if (m[13] !== undefined) out.push(<span key={k} className="dc-ping">@роль</span>);
    else if (m[14] !== undefined) out.push(<span key={k} className="dc-ping">#канал</span>);
    else if (m[15] !== undefined) out.push(<span key={k} className="dc-emoji" title={`:${m[15]}:`}>:{m[15]}:</span>);
    else if (m[16] !== undefined) out.push(<span key={k} className="dc-ping">@{m[16]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function DiscordMarkdown({ text, ctx }: { text: string; ctx: DiscordContext }) {
  const lines = text.split("\n");
  return (
    <div className="dc-md">
      {lines.map((line, i) => {
        const h = /^(#{1,3}) (.+)$/.exec(line);
        if (h) return <div key={i} className={`dc-h${h[1]!.length}`}>{inline(h[2]!, ctx)}</div>;
        if (line.startsWith("-# ")) return <div key={i} className="dc-sub">{inline(line.slice(3), ctx)}</div>;
        if (/^[-*] /.test(line)) return <div key={i} className="dc-li">{inline(line.slice(2), ctx)}</div>;
        if (line.startsWith("> ")) return <div key={i} className="dc-quote">{inline(line.slice(2), ctx)}</div>;
        return <div key={i}>{line ? inline(line, ctx) : " "}</div>;
      })}
    </div>
  );
}
