import { NextResponse } from "next/server";
import { prisma } from "@flamebot/core";
import { getUser } from "@/lib/session";

// Картинки постов о вайпе видны только вошедшим в панель.
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  if (!(await getUser())) return new NextResponse(null, { status: 401 });
  const { kind } = await params;
  if (kind !== "regular" && kind !== "global") return new NextResponse(null, { status: 404 });

  const img = await prisma.noticeImage.findUnique({ where: { kind } });
  if (!img) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(img.data), {
    headers: {
      "Content-Type": ["image/png", "image/jpeg", "image/webp"].includes(img.mime) ? img.mime : "application/octet-stream",
      "Content-Length": String(img.data.length),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
