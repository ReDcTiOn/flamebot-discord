// Генерирует ключ для шифрования секретов бота онлайна.
// Строку ONLINE_SECRET_KEY=... добавь в .env. Никому её не показывай и не коммить.
import { generateSecretKeyPair } from "@flamebot/core";

const { privateKey } = generateSecretKeyPair();
console.log(`ONLINE_SECRET_KEY=${privateKey}`);
