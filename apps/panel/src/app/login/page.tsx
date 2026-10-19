import { redirect } from "next/navigation";
import { Flame } from "lucide-react";
import { getUser } from "@/lib/session";

export const metadata = { title: "Вход" };

const ERRORS: Record<string, string> = {
  state: "Ссылка для входа устарела. Попробуй ещё раз.",
  cancelled: "Вход отменён.",
  not_member: "Тебя нет на нашем сервере Discord.",
  denied: "У тебя нет доступа к панели. Его выдают администраторы сервера.",
  discord: "Discord не ответил. Попробуй через минуту.",
  rate: "Слишком много попыток входа. Подожди минуту.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getUser()) redirect("/");
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;

  return (
    <main className="login">
      <div className="login-card">
        <div className="login-mark">
          <Flame size={26} aria-hidden="true" />
        </div>
        <h1>FlameBot</h1>
        <p>Панель управления ботами сервера. Вход только для администрации.</p>
        {message && (
          <p role="alert" className="form-status error" style={{ marginBottom: 16 }}>
            {message}
          </p>
        )}
        {/* Обычная ссылка: переход на Discord делает сервер, токены в браузер не попадают. */}
        <a className="btn discord" href="/api/auth/login">
          Войти через Discord
        </a>
      </div>
    </main>
  );
}
