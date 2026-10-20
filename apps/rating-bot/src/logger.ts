import { logEvent } from "./services/events.js";

type Level = "info" | "warn" | "error";

function write(level: Level, message: string, err?: unknown) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (err instanceof Error) out(line, `\n  ${err.name}: ${err.message}`);
  else if (err !== undefined) out(line, err);
  else out(line);
}

// Предупреждения и ошибки дублируются в историю событий, чтобы их было видно в панели.
export const log = {
  info: (m: string) => write("info", m),
  warn: (m: string, e?: unknown) => {
    write("warn", m, e);
    logEvent("WARN", m, e);
  },
  error: (m: string, e?: unknown) => {
    write("error", m, e);
    logEvent("ERROR", m, e);
  },
};
