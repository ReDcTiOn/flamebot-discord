import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { CARD_ICON_FILES } from "@flamebot/core/card";

// Встроенные иконки (скрап и т. п.) для панели и редактора карточки. Отдаём только файлы из списка.
const ICONS_DIR = path.resolve(process.cwd(), "../../packages/core/assets/icons");

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!CARD_ICON_FILES.includes(file)) return new NextResponse(null, { status: 404 });
  try {
    const data = await readFile(path.join(ICONS_DIR, file));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
