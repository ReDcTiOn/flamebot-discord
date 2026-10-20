import { NextResponse } from "next/server";
import { prisma } from "@flamebot/core";
import { getUser } from "@/lib/session";

// Картинки карточки видны только вошедшим в панель.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getUser())) return new NextResponse(null, { status: 401 });

  const { id: raw } = await params;
  const id = /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  if (!id) return new NextResponse(null, { status: 404 });

  const asset = await prisma.cardAsset.findUnique({ where: { id } });
  if (!asset) return new NextResponse(null, { status: 404 });

  return new NextResponse(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime === "image/jpeg" ? "image/jpeg" : "image/png",
      "Content-Length": String(asset.data.length),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
