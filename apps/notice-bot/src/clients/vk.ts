import { sleep } from "../events.js";
import { SendError, uploadName, type Image } from "./discord.js";

// Пост на стене сообщества ВКонтакте. Ключ доступа уходит только в теле запроса и в тексты ошибок не попадает.

const VK_API = "https://api.vk.com/method/";
const VK_VERSION = "5.199";

async function call<T>(method: string, token: string, params: Record<string, string | number>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: token, v: VK_VERSION });
    const res = await fetch(VK_API + method, { method: "POST", body, signal: AbortSignal.timeout(30_000) });
    const js = (await res.json().catch(() => null)) as { response?: T; error?: { error_code?: number; error_msg?: string } } | null;
    if (!js) throw new SendError(`ВКонтакте ${method}: ответ ${res.status} не JSON`);
    // 6 — слишком частые запросы.
    if (js.error?.error_code === 6 && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (js.error) throw new SendError(`ВКонтакте ${method}: [${js.error.error_code}] ${js.error.error_msg}`);
    return js.response as T;
  }
  throw new SendError(`ВКонтакте ${method}: исчерпаны попытки`);
}

async function uploadPhoto(token: string, groupId: number, img: Image): Promise<string> {
  let server: { upload_url: string };
  try {
    server = await call("photos.getWallUploadServer", token, { group_id: groupId });
  } catch (err) {
    if (String(err).includes("[27]")) {
      throw new SendError(`${(err as Error).message}. Ключ сообщества не может загружать фото: загрузи картинки в сообщество вручную и укажи их ID в настройках`);
    }
    throw err;
  }
  const form = new FormData();
  form.set("photo", new Blob([new Uint8Array(img.data)], { type: img.mime }), uploadName(img));
  const up = (await (await fetch(server.upload_url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) })).json()) as {
    photo?: string;
    server?: number;
    hash?: string;
  };
  if (!up.photo || up.photo === "[]") throw new SendError("ВКонтакте: не удалось загрузить картинку");
  const saved = await call<{ owner_id: number; id: number }[]>("photos.saveWallPhoto", token, {
    group_id: groupId,
    photo: up.photo,
    server: up.server ?? 0,
    hash: up.hash ?? "",
  });
  return `photo${saved[0]!.owner_id}_${saved[0]!.id}`;
}

// photo — ID уже загруженного фото «photo-1_2». Без него картинка загружается заново
// (для этого нужен ключ с правом на фотографии).
export async function sendVk(token: string, groupId: number, text: string, img: Image, photo: string | null): Promise<string> {
  const attachment = photo ?? (await uploadPhoto(token, groupId, img));
  let post: { post_id: number };
  try {
    post = await call("wall.post", token, { owner_id: -groupId, from_group: 1, message: text, attachments: attachment });
  } catch (err) {
    if (err instanceof SendError) throw err;
    throw new SendError("ВКонтакте: ответ на wall.post не получен. Пост мог опубликоваться — проверь стену, прежде чем повторять");
  }
  return `https://vk.com/wall-${groupId}_${post.post_id}`;
}

// Проверка ключа без публикации: название сообщества.
export async function checkVk(token: string, groupId: number): Promise<string> {
  const res = await call<{ groups?: { name: string }[] } | { name: string }[]>("groups.getById", token, { group_id: groupId });
  const list = Array.isArray(res) ? res : (res.groups ?? []);
  return list[0]?.name ?? `сообщество ${groupId}`;
}
