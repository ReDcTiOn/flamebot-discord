import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { CARD_FONT_FILES } from "@flamebot/core/card";

// Шрифты карточки для редактора. Отдаём только файлы из списка, путь из запроса
// в файловую систему не попадает.
const FONTS_DIR = path.resolve(process.cwd(), "../../packages/core/assets/fonts");

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!CARD_FONT_FILES.includes(file)) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(path.join(FONTS_DIR, file));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=604800, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
