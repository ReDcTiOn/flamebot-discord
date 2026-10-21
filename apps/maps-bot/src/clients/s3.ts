import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";

// S3-совместимое хранилище (Selectel) без SDK: подпись запросов AWS SigV4.
// Файл карты уходит одним PUT потоком из файла; тело не подписывается (UNSIGNED-PAYLOAD),
// как это делает boto3 по HTTPS. Целостность проверяется сравнением размера после загрузки.

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
  addressing: "path" | "virtual";
  cdnBaseUrl: string;
}

// Кодирование пути как в S3 (RFC 3986): всё, кроме A-Z a-z 0-9 - _ . ~ и «/».
export const encodeKey = (key: string) =>
  key
    .split("/")
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

interface S3Response {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export class S3Storage {
  constructor(private readonly c: S3Config) {}

  keyFor(folder: string, filename: string): string {
    return this.c.prefix ? `${this.c.prefix}/${folder}/${filename}` : `${folder}/${filename}`;
  }

  // Имена файлов могут содержать пробелы и т. п.
  cdnUrl(key: string): string {
    return `${this.c.cdnBaseUrl}/${encodeKey(key)}`;
  }

  private target(key: string): URL {
    const base = new URL(this.c.endpoint);
    if (this.c.addressing === "virtual") {
      base.hostname = `${this.c.bucket}.${base.hostname}`;
      base.pathname = `/${encodeKey(key)}`;
    } else {
      base.pathname = `/${encodeKey(this.c.bucket)}/${encodeKey(key)}`;
    }
    return base;
  }

  private sign(method: string, url: URL, extra: Record<string, string> = {}): Record<string, string> {
    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const day = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
      "x-amz-date": amzDate,
    };
    const signed = Object.keys(headers).sort();
    const canonical = [
      method,
      url.pathname,
      "",
      ...signed.map((h) => `${h}:${headers[h]}`),
      "",
      signed.join(";"),
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const scope = `${day}/${this.c.region}/s3/aws4_request`;
    const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
    let key = hmac(`AWS4${this.c.secretKey}`, day);
    key = hmac(key, this.c.region);
    key = hmac(key, "s3");
    key = hmac(key, "aws4_request");
    const signature = createHmac("sha256", key).update(toSign).digest("hex");
    return {
      ...headers,
      ...extra,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.c.accessKey}/${scope}, SignedHeaders=${signed.join(";")}, Signature=${signature}`,
    };
  }

  private send(method: string, key: string, body?: { path: string; size: number }): Promise<S3Response> {
    const url = this.target(key);
    const extra: Record<string, string> = body ? { "content-length": String(body.size), "content-type": "application/octet-stream" } : {};
    const headers = this.sign(method, url, extra);
    const lib = url.protocol === "http:" ? http : https;
    return new Promise((resolve, reject) => {
      const req = lib.request(url, { method, headers, timeout: 15 * 60_000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.length < 64 && chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8").slice(0, 500) }));
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error("S3 не ответило вовремя")));
      req.on("error", reject);
      if (body) createReadStream(body.path).on("error", reject).pipe(req);
      else req.end();
    });
  }

  private static fail(what: string, r: S3Response): Error {
    const code = /<Code>([^<]+)<\/Code>/.exec(r.body)?.[1];
    return new Error(`S3 ${what}: ${r.status}${code ? ` ${code}` : ""}`);
  }

  async upload(path: string, key: string): Promise<void> {
    const { size } = await stat(path);
    const put = await this.send("PUT", key, { path, size });
    if (put.status < 200 || put.status >= 300) throw S3Storage.fail("загрузка", put);
    const remote = await this.size(key);
    if (remote !== size) throw new Error(`После загрузки размер в S3 ${remote} не равен локальному ${size}`);
  }

  async size(key: string): Promise<number | null> {
    const r = await this.send("HEAD", key);
    if (r.status === 404) return null;
    if (r.status !== 200) throw S3Storage.fail("проверка", r);
    return Number(r.headers["content-length"] ?? -1);
  }

  async remove(key: string): Promise<void> {
    const r = await this.send("DELETE", key);
    if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw S3Storage.fail("удаление", r);
  }

  // null — ссылка отдаётся и размер совпал, иначе текст проблемы.
  async checkPublic(url: string, expectedSize: number): Promise<string | null> {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(20_000) });
      if (res.status !== 200) return `HEAD ${url} -> ${res.status}`;
      const length = res.headers.get("content-length");
      if (length && Number(length) !== expectedSize) return `по ссылке размер ${length}, ожидали ${expectedSize}`;
      return null;
    } catch (err) {
      return `ссылка недоступна: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}
