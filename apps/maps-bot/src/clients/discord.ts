// Анонс в Discord через вебхук: ни бот, ни его токен для этого не нужны.

export async function sendWebhook(url: string, payload: unknown): Promise<void> {
  const res = await fetch(`${url}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status >= 300) throw new Error(`Discord ${res.status}: ${(await res.text()).slice(0, 300)}`);
  await res.body?.cancel();
}

// Проверка вебхука без отправки сообщения: GET отдаёт его имя и канал.
export async function checkWebhook(url: string): Promise<{ name: string; channelId: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404 || res.status === 401) throw new Error("Discord не знает этот вебхук: он удалён или ссылка неверная");
  if (!res.ok) throw new Error(`Discord ответил ${res.status}`);
  const body = (await res.json()) as { name?: string; channel_id?: string };
  return { name: body.name ?? "вебхук", channelId: body.channel_id ?? "" };
}
