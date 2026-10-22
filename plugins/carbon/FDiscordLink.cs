using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Oxide.Core;
using Oxide.Core.Libraries;
using UnityEngine;

namespace Carbon.Plugins
{
    // Привязка Steam к Discord. Игрок пишет /connect, плагин получает код у бота FlameBot
    // (HTTP API, ключ сервера из панели «Привязка Steam» → «Игровые серверы») и показывает его.
    // Игрок нажимает «Привязать» в Discord и вводит код. Связка хранится в базе бота, общая для всех серверов.
    //
    // Для других плагинов:
    //   Call("IsLinked", ulong steamId) -> bool
    //   Call("GetDiscordId", ulong steamId) -> string (null, если не привязан)
    //   Call("GetDiscordName", ulong steamId) -> string
    //   хук OnDiscordLinked(BasePlayer player, string discordId) — игрок только что привязал аккаунт.
    [Info("FDiscordLink", "FlameRust", "1.0.0")]
    [Description("Привязка аккаунта Steam к Discord через код из чата")]
    public class FDiscordLink : CarbonPlugin
    {
        #region [Vars]
        private static Configuration _config;

        // Привязки, которые бот уже подтвердил. Обновляются при входе игрока и раз в несколько минут.
        private readonly Dictionary<UInt64, LinkInfo> _links = new Dictionary<UInt64, LinkInfo>();
        // Игроки, которым выдан код: до какого момента ждём, что код введут в Discord.
        private readonly Dictionary<UInt64, Single> _pending = new Dictionary<UInt64, Single>();
        private readonly Dictionary<UInt64, Single> _cooldown = new Dictionary<UInt64, Single>();
        private readonly HashSet<UInt64> _inFlight = new HashSet<UInt64>();

        private Boolean _lookupRunning;

        private const Int32 LookupBatch = 200;
        private const Single RequestTimeout = 10f;

        private sealed class LinkInfo
        {
            public String DiscordId;
            public String DiscordName;
        }
        #endregion

        #region [Configuration]
        private sealed class Configuration
        {
            [JsonProperty("Адрес API (из панели: «Привязка Steam» → «Игровые серверы»)")]
            public String ApiUrl = "https://bots.flamerust.gg/link-api";

            [JsonProperty("Ключ API сервера")]
            public String ApiKey = "";

            [JsonProperty("Команды для получения кода")]
            public List<String> Commands = new List<String> { "connect", "link" };

            [JsonProperty("Ссылка на Discord (показывается игроку)")]
            public String DiscordInvite = "discord.gg/flamerust";

            [JsonProperty("Как часто проверять, ввёл ли игрок код (секунд)")]
            public Single PollSeconds = 10f;

            [JsonProperty("Как часто обновлять привязки игроков онлайн (минут)")]
            public Single RefreshMinutes = 5f;

            [JsonProperty("Повторная команда не чаще (секунд)")]
            public Single CooldownSeconds = 5f;

            public VersionNumber Version = new VersionNumber();
        }

        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<Configuration>();
                if (_config is null)
                    throw new Exception();

                if (_config.Version < Version)
                    _config.Version = Version;

                SaveConfig();
            }
            catch
            {
                PrintError("Конфиг повреждён, загружаю значения по умолчанию");
                LoadDefaultConfig();
            }
        }

        protected override void SaveConfig() => Config.WriteObject(_config);
        protected override void LoadDefaultConfig() => _config = new Configuration();
        #endregion

        #region [Lang]
        protected override void LoadDefaultMessages()
        {
            lang.RegisterMessages(new Dictionary<String, String>
            {
                ["NotConfigured"] = "Привязка к Discord пока не настроена. Попробуйте позже.",
                ["Cooldown"] = "Подождите пару секунд.",
                ["Wait"] = "Получаю код, секунду...",
                ["Code"] = "<size=16>Ваш код: <color=#66c0f4>{0}</color></size>\nЗайдите в наш Discord <color=#66c0f4>{1}</color>, откройте канал <color=#66c0f4>#{2}</color>, нажмите «Привязать» и введите код.\nКод действует {3} мин. Он продублирован в консоли (F1), оттуда его можно скопировать.",
                ["CodeConsole"] = "[FDiscordLink] Код для привязки Discord: {0}",
                ["AlreadyLinked"] = "Ваш аккаунт уже привязан к Discord <color=#66c0f4>@{0}</color>. Сменить привязку может администрация.",
                ["Linked"] = "<color=#66c0f4>Готово!</color> Аккаунт привязан к Discord <color=#66c0f4>@{0}</color>.",
                ["Unavailable"] = "{0}",
                ["Error"] = "Сервер привязки недоступен. Попробуйте позже."
            }, this, "ru");

            lang.RegisterMessages(new Dictionary<String, String>
            {
                ["NotConfigured"] = "Discord linking is not configured yet. Please try again later.",
                ["Cooldown"] = "Please wait a couple of seconds.",
                ["Wait"] = "Getting your code...",
                ["Code"] = "<size=16>Your code: <color=#66c0f4>{0}</color></size>\nJoin our Discord <color=#66c0f4>{1}</color>, open <color=#66c0f4>#{2}</color>, press \"Привязать\" and enter the code.\nThe code is valid for {3} min. It is also printed in the console (F1) so you can copy it.",
                ["CodeConsole"] = "[FDiscordLink] Discord link code: {0}",
                ["AlreadyLinked"] = "Your account is already linked to Discord <color=#66c0f4>@{0}</color>. Ask the staff to change it.",
                ["Linked"] = "<color=#66c0f4>Done!</color> Your account is linked to Discord <color=#66c0f4>@{0}</color>.",
                ["Unavailable"] = "Discord linking is temporarily unavailable. Please try again later.",
                ["Error"] = "The linking server is unavailable. Please try again later."
            }, this, "en");
        }

        private String Msg(BasePlayer player, String key, params System.Object[] args)
        {
            String text = lang.GetMessage(key, this, player.UserIDString);
            return args.Length == 0 ? text : String.Format(text, args);
        }
        #endregion

        #region [Oxide-Api]
        private void Init()
        {
            foreach (String command in _config.Commands)
            {
                if (!String.IsNullOrWhiteSpace(command))
                    cmd.AddChatCommand(command.Trim().TrimStart('/'), this, CmdConnect);
            }
        }

        private void OnServerInitialized()
        {
            if (!IsConfigured())
                PrintWarning("Не задан ключ API. Возьми его в панели: «Привязка Steam» → «Игровые серверы», впиши в конфиг и выполни c.reload FDiscordLink");

            // Таймеры плагина Carbon останавливает сам при выгрузке.
            timer.Every(Mathf.Max(3f, _config.PollSeconds), PollPending);
            timer.Every(Mathf.Max(1f, _config.RefreshMinutes) * 60f, RefreshOnline);
            RefreshOnline();
        }

        private void Unload()
        {
            _config = null;
        }

        private void OnPlayerConnected(BasePlayer player)
        {
            if (player == null || !IsConfigured()) return;

            Lookup(new List<String> { player.UserIDString }, true);
        }

        private void OnPlayerDisconnected(BasePlayer player, String reason)
        {
            if (player == null) return;

            _pending.Remove(player.userID);
            _cooldown.Remove(player.userID);
        }
        #endregion

        #region [Command]
        private void CmdConnect(BasePlayer player, String command, String[] args)
        {
            if (player == null) return;

            if (!IsConfigured())
            {
                player.ChatMessage(Msg(player, "NotConfigured"));
                return;
            }

            UInt64 userId = player.userID;
            Single now = UnityEngine.Time.realtimeSinceStartup;
            if (_cooldown.TryGetValue(userId, out Single until) && until > now)
            {
                player.ChatMessage(Msg(player, "Cooldown"));
                return;
            }
            _cooldown[userId] = now + _config.CooldownSeconds;

            if (_links.TryGetValue(userId, out LinkInfo link))
            {
                player.ChatMessage(Msg(player, "AlreadyLinked", link.DiscordName));
                return;
            }

            if (!_inFlight.Add(userId)) return;

            String body = JsonConvert.SerializeObject(new { steamId = player.UserIDString, name = player.displayName });
            Request("/v1/code", body, (code, response) =>
            {
                _inFlight.Remove(userId);
                BasePlayer target = BasePlayer.FindByID(userId);
                if (target == null) return;

                CodeResponse result = Parse<CodeResponse>(response);
                if (result == null || code == 0 || code == 401 || code == 403 || (code >= 500 && result.Status != "unavailable"))
                {
                    LogHttpError("/v1/code", code, result?.Message);
                    target.ChatMessage(Msg(target, "Error"));
                    return;
                }

                switch (result.Status)
                {
                    case "linked":
                        _links[userId] = new LinkInfo { DiscordId = result.DiscordId, DiscordName = result.DiscordName };
                        target.ChatMessage(Msg(target, "AlreadyLinked", result.DiscordName));
                        break;
                    case "code":
                        _pending[userId] = UnityEngine.Time.realtimeSinceStartup + Mathf.Max(30, result.TtlSeconds);
                        Int32 minutes = Mathf.Max(1, Mathf.CeilToInt(result.TtlSeconds / 60f));
                        target.ChatMessage(Msg(target, "Code", result.Code, _config.DiscordInvite, result.Channel, minutes));
                        target.ConsoleMessage(Msg(target, "CodeConsole", result.Code));
                        break;
                    case "unavailable":
                        target.ChatMessage(Msg(target, "Unavailable", result.Message ?? Msg(target, "Error")));
                        break;
                    default:
                        LogHttpError("/v1/code", code, result.Message);
                        target.ChatMessage(Msg(target, "Error"));
                        break;
                }
            });
        }

        [ConsoleCommand("discordlink.check")]
        private void CcmdCheck(ConsoleSystem.Arg arg)
        {
            // Только из консоли сервера или RCON.
            if (arg.Connection != null) return;

            if (!IsConfigured())
            {
                PrintWarning("Не задан ключ API в конфиге");
                return;
            }

            Request("/v1/ping", null, (code, response) =>
            {
                PingResponse ping = Parse<PingResponse>(response);
                if (code == 200 && ping != null && ping.Ok)
                    Puts($"Связь с ботом есть. Сервер в панели: «{ping.Server}». Бот в Discord: {(ping.Discord ? "да" : "нет, коды не выдаются")}.");
                else
                    LogHttpError("/v1/ping", code, ping?.Message);
            });
        }
        #endregion

        #region [Functional]
        private Boolean IsConfigured() => !String.IsNullOrWhiteSpace(_config.ApiKey) && !String.IsNullOrWhiteSpace(_config.ApiUrl);

        // Ждём, пока игроки с кодом введут его в Discord, и поздравляем их в игре.
        private void PollPending()
        {
            if (_pending.Count == 0 || _lookupRunning) return;

            Single now = UnityEngine.Time.realtimeSinceStartup;
            List<String> ids = new List<String>();
            foreach (KeyValuePair<UInt64, Single> pair in new List<KeyValuePair<UInt64, Single>>(_pending))
            {
                if (pair.Value < now) _pending.Remove(pair.Key);
                else ids.Add(pair.Key.ToString());
            }
            if (ids.Count > 0) Lookup(ids, false);
        }

        // Привязки всех игроков онлайн: так видно и отвязку из панели, а бот знает, что сервер на связи.
        private void RefreshOnline()
        {
            if (!IsConfigured()) return;

            List<String> ids = new List<String>();
            foreach (BasePlayer player in BasePlayer.activePlayerList)
                ids.Add(player.UserIDString);

            for (Int32 i = 0; i < ids.Count; i += LookupBatch)
                Lookup(ids.GetRange(i, Math.Min(LookupBatch, ids.Count - i)), true);
        }

        // full = true: кого нет в ответе, тот не привязан (например, отвязан в панели).
        private void Lookup(List<String> steamIds, Boolean full)
        {
            if (steamIds.Count == 0) return;
            if (!full) _lookupRunning = true;

            String body = JsonConvert.SerializeObject(new { steamIds });
            Request("/v1/lookup", body, (code, response) =>
            {
                if (!full) _lookupRunning = false;

                LookupResponse result = Parse<LookupResponse>(response);
                if (code != 200 || result?.Links == null)
                {
                    LogHttpError("/v1/lookup", code, result?.Message);
                    return;
                }

                HashSet<UInt64> found = new HashSet<UInt64>();
                foreach (LinkEntry entry in result.Links)
                {
                    if (!UInt64.TryParse(entry.SteamId, out UInt64 userId)) continue;
                    found.Add(userId);
                    _links[userId] = new LinkInfo { DiscordId = entry.DiscordId, DiscordName = entry.DiscordName };

                    if (!_pending.Remove(userId)) continue;
                    BasePlayer player = BasePlayer.FindByID(userId);
                    if (player == null) continue;
                    player.ChatMessage(Msg(player, "Linked", entry.DiscordName));
                    Interface.CallHook("OnDiscordLinked", player, entry.DiscordId);
                }

                if (!full) return;
                foreach (String id in steamIds)
                {
                    if (UInt64.TryParse(id, out UInt64 userId) && !found.Contains(userId))
                        _links.Remove(userId);
                }
            });
        }

        private void Request(String path, String body, Action<Int32, String> callback)
        {
            String url = _config.ApiUrl.TrimEnd('/') + path;
            Dictionary<String, String> headers = new Dictionary<String, String>
            {
                ["Authorization"] = "Bearer " + _config.ApiKey.Trim(),
                ["Content-Type"] = "application/json"
            };
            RequestMethod method = body == null ? RequestMethod.GET : RequestMethod.POST;
            webrequest.Enqueue(url, body, callback, this, method, headers, RequestTimeout);
        }

        private static T Parse<T>(String json) where T : class
        {
            if (String.IsNullOrEmpty(json)) return null;
            try
            {
                return JsonConvert.DeserializeObject<T>(json);
            }
            catch
            {
                return null;
            }
        }

        private void LogHttpError(String path, Int32 code, String message)
        {
            if (code == 0)
                PrintWarning($"Бот привязки не ответил ({path}). Проверь «Адрес API» в конфиге и что бот запущен.");
            else if (code == 401)
                PrintError("Бот не принял ключ API. Возьми новый в панели: «Привязка Steam» → «Игровые серверы».");
            else
                PrintWarning($"Ошибка API привязки {path}: HTTP {code}{(String.IsNullOrEmpty(message) ? "" : " — " + message)}");
        }
        #endregion

        #region [API]
        private Boolean IsLinked(UInt64 steamId) => _links.ContainsKey(steamId);

        private String GetDiscordId(UInt64 steamId) => _links.TryGetValue(steamId, out LinkInfo link) ? link.DiscordId : null;

        private String GetDiscordName(UInt64 steamId) => _links.TryGetValue(steamId, out LinkInfo link) ? link.DiscordName : null;
        #endregion

        #region [Responses]
        private sealed class CodeResponse
        {
            [JsonProperty("status")] public String Status;
            [JsonProperty("code")] public String Code;
            [JsonProperty("ttlSeconds")] public Int32 TtlSeconds;
            [JsonProperty("channel")] public String Channel;
            [JsonProperty("discordId")] public String DiscordId;
            [JsonProperty("discordName")] public String DiscordName;
            [JsonProperty("message")] public String Message;
        }

        private sealed class LookupResponse
        {
            [JsonProperty("links")] public List<LinkEntry> Links;
            [JsonProperty("message")] public String Message;
        }

        private sealed class LinkEntry
        {
            [JsonProperty("steamId")] public String SteamId;
            [JsonProperty("discordId")] public String DiscordId;
            [JsonProperty("discordName")] public String DiscordName;
        }

        private sealed class PingResponse
        {
            [JsonProperty("ok")] public Boolean Ok;
            [JsonProperty("server")] public String Server;
            [JsonProperty("discord")] public Boolean Discord;
            [JsonProperty("message")] public String Message;
        }
        #endregion
    }
}
