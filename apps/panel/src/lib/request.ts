import { env } from "./env";

type HeaderReader = { get(name: string): string | null };

export function clientIp(h: HeaderReader): string {
  if (env().TRUST_PROXY) {
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 64);
    const real = h.get("x-real-ip")?.trim();
    if (real) return real.slice(0, 64);
  }
  return "direct";
}
