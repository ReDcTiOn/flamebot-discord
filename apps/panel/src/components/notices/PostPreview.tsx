import type { ReactNode } from "react";

// Превью объявления: как оно примерно будет выглядеть в Discord и ВКонтакте.
// Разметку Discord (**жирный**, [текст](ссылка)) превращаем в элементы React, без вставки HTML.

const EMOJI = /<a?:\w+:\d+>/g;
const TOKENS = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gs;

function md(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const src = text.replace(EMOJI, "▪️");
  let last = 0;
  for (const m of src.matchAll(TOKENS)) {
    if (m.index! > last) out.push(src.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={m.index}>{m[1]}</b>);
    else
      out.push(
        <a key={m.index} href={m[3]} className="link" target="_blank" rel="noreferrer noopener">
          {m[2]}
        </a>,
      );
    last = m.index! + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

const hex = (n: unknown) => (typeof n === "number" && n >= 0 ? `#${n.toString(16).padStart(6, "0")}` : undefined);

export function PostPreview({ discord, vk, imageUrl }: { discord: Record<string, unknown>; vk: string; imageUrl: string | null }) {
  const content = String(discord.content ?? "").trim();
  const embeds = (Array.isArray(discord.embeds) ? discord.embeds : []) as Record<string, unknown>[];
  return (
    <div className="post-preview">
      <div className="post-box">
        <div className="post-box-head">
          <span>Discord{typeof discord.username === "string" ? ` · ${discord.username}` : ""}</span>
        </div>
        {content && (/^@(everyone|here)$/.test(content) ? <span className="dc-ping">{content}</span> : <div className="vk-post">{md(content)}</div>)}
        {embeds.map((e, i) => (
          <div key={i} className="dc-embed" style={{ ["--embed" as string]: hex(e.color) }}>
            {typeof e.title === "string" && <div className="dc-embed-title">{md(e.title)}</div>}
            {typeof e.description === "string" && <div>{md(e.description)}</div>}
            {((Array.isArray(e.fields) ? e.fields : []) as { name?: string; value?: string }[]).map((f, j) => (
              <div key={j} style={{ marginTop: 6 }}>
                <b>{f.name}</b>
                <div>{md(String(f.value ?? ""))}</div>
              </div>
            ))}
            {/* В первый embed бот всегда ставит картинку поста. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {i === 0 && imageUrl && <img className="post-image" src={imageUrl} alt="Картинка поста" loading="lazy" />}
          </div>
        ))}
      </div>
      <div className="post-box">
        <div className="post-box-head">
          <span>ВКонтакте</span>
        </div>
        <div className="vk-post">{vk}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {imageUrl && <img className="post-image" src={imageUrl} alt="Картинка поста" loading="lazy" />}
      </div>
    </div>
  );
}
