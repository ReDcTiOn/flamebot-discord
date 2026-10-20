import { EventEmitter } from "node:events";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import WebSocket from "ws";
import { isPrivateAddress } from "@flamebot/core";

// Клиент Rust WebRCON: ws://адрес:порт/пароль, запросы и ответы в JSON.
// События: connect, message ({ Message, Identifier, Type }), disconnect, error.

export interface RconMessage {
  Message: string;
  Identifier: number;
  Type: string;
}

export class WebRcon extends EventEmitter {
  private socket: WebSocket | null = null;
  connected = false;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly allowPrivate: boolean,
  ) {
    super();
  }

  async connect(password: string): Promise<void> {
    // Адрес проверяем после DNS: так нельзя подсунуть имя, которое указывает внутрь сети.
    const ip = isIP(this.host) ? this.host : (await lookup(this.host)).address;
    if (!this.allowPrivate && isPrivateAddress(ip)) {
      throw new Error(`адрес ${ip} внутренний, подключение запрещено`);
    }
    const hostPart = isIP(ip) === 6 ? `[${ip}]` : ip;
    const ws = new WebSocket(`ws://${hostPart}:${this.port}/${encodeURIComponent(password)}`, {
      handshakeTimeout: 30_000,
      maxPayload: 4 * 1024 * 1024,
      followRedirects: false,
    });
    this.socket = ws;

    ws.on("open", () => {
      this.connected = true;
      this.emit("connect");
    });
    ws.on("message", (raw) => {
      let msg: RconMessage;
      try {
        msg = JSON.parse(raw.toString()) as RconMessage;
      } catch {
        return;
      }
      if (msg && typeof msg.Message === "string") this.emit("message", msg);
    });
    ws.on("close", () => {
      const was = this.connected;
      this.connected = false;
      this.emit("disconnect", was);
    });
    ws.on("error", (err) => this.emit("error", err));
  }

  run(command: string, identifier: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("соединение не открыто");
    this.socket.send(JSON.stringify({ Identifier: identifier, Message: command, Name: "WebRcon" }));
  }

  close(): void {
    this.removeAllListeners();
    this.on("error", () => undefined);
    try {
      this.socket?.terminate();
    } catch {
      // Уже закрыто.
    }
    this.socket = null;
    this.connected = false;
  }
}
