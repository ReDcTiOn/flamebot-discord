// Кликабельные упоминания команд: </rep:ID>. Discord сам покажет название на языке игрока
// (/реп или /rep) и даст запустить команду нажатием. ID приходят при регистрации команд.
const ids = new Map<string, string>();

export function rememberCommandIds(registered: readonly { id: string; name: string }[]): void {
  for (const c of registered) ids.set(c.name, c.id);
}

// До регистрации (или если она не удалась) — просто текст /name.
export function commandMention(name: string): string {
  const id = ids.get(name);
  return id ? `</${name}:${id}>` : `/${name}`;
}
