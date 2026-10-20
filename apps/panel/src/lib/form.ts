import { SNOWFLAKE } from "@flamebot/core";
import { ActionError } from "./auth";

// Разбор FormData в типизированные значения. Окончательную проверку делает zod-схема.

export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
}

export function strOrNull(fd: FormData, name: string): string | null {
  const v = str(fd, name).trim();
  return v === "" ? null : v;
}

export function int(fd: FormData, name: string): number {
  const raw = str(fd, name).trim().replace(/\s/g, "");
  if (!/^-?\d+$/.test(raw)) throw new ActionError("Числовые поля должны содержать целые числа");
  return Number(raw);
}

export function intOrNull(fd: FormData, name: string): number | null {
  return str(fd, name).trim() === "" ? null : int(fd, name);
}

// Дробное число с точностью до сотых. Понимает и «0,01», и «0.01».
export function dec(fd: FormData, name: string): number {
  const raw = str(fd, name).trim().replace(/\s/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) throw new ActionError("Числа — не больше двух знаков после запятой, например 0.01");
  return Math.round(Number(raw) * 100) / 100;
}

export function decOrNull(fd: FormData, name: string): number | null {
  return str(fd, name).trim() === "" ? null : dec(fd, name);
}

export function bool(fd: FormData, name: string): boolean {
  return fd.get(name) === "on";
}

export function ids(fd: FormData, name: string): string[] {
  return [...new Set(fd.getAll(name).filter((v): v is string => typeof v === "string" && SNOWFLAKE.test(v)))];
}

export function idParam(fd: FormData, name = "id"): number {
  const id = int(fd, name);
  if (id <= 0) throw new ActionError("Неверный идентификатор");
  return id;
}
