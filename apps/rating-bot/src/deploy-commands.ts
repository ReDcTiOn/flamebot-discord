// Регистрирует слэш-команды на сервере GUILD_ID. Запускать после изменения команд.
import { REST, Routes } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";

const rest = new REST().setToken(config.DISCORD_TOKEN);
const body = commands.map((c) => c.data);

await rest.put(Routes.applicationGuildCommands(config.DISCORD_CLIENT_ID, config.GUILD_ID), { body });
console.log(`Зарегистрировано команд: ${body.length}`);
process.exit(0);
