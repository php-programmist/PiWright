/* Manual smoke: headless web server (out/headless/index.js, pure node). Checks:
   (1) server starts and prints the URL/PIN line, (2) static renderer is served
   (index.html + asset), (3) PIN login → cookie → WS /rpc → hello → invoke round-trips
   (app:version, settings:get), (4) unknown channel fails, (5) SIGINT shuts down cleanly.
   Launch: node tests/manual/smoke-headless.cjs  (builds are expected in out/). */
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.SMOKE_PORT || 7791);
const PIN = "345345";

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "piwright-headless-smoke-"));
fs.mkdirSync(userData, { recursive: true });
/* Настройки сеются до старта: headless читает их один раз; staticPin — детерминированный PIN. */
fs.writeFileSync(
  path.join(userData, "settings.json"),
  JSON.stringify({ notifications: { remote: { staticPin: PIN } } }),
  "utf8"
);

function postLogin(port, pin) {
  return new Promise((resolve, reject) => {
    const body = `pin=${encodeURIComponent(pin)}`;
    const req = http.request(
      { host: "127.0.0.1", port, path: "/login", method: "POST", headers: { "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, setCookie: res.headers["set-cookie"] ?? [] }));
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

function get(port, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, headers: cookie ? { Cookie: cookie } : {} },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], body: data }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/* Минимальный WS-клиент поверх net.Socket (браузерный WebSocket не даёт ставить Cookie). */
function wsConnect(port, cookie) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    const socket = net.connect(port, "127.0.0.1", () => {
      socket.write(
        `GET /rpc HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nCookie: ${cookie}\r\n\r\n`
      );
    });
    let buffer = Buffer.alloc(0);
    let handshaken = false;
    const frames = [];
    let waiters = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!handshaken) {
        const idx = buffer.indexOf("\r\n\r\n");
        if (idx < 0) return;
        const head = buffer.subarray(0, idx).toString("utf8");
        if (!head.includes("101")) {
          reject(new Error(`handshake failed: ${head.split("\r\n")[0]}`));
          socket.destroy();
          return;
        }
        handshaken = true;
        buffer = buffer.subarray(idx + 4);
        resolve({
          nextFrame: () =>
            new Promise((res, rej) => {
              if (frames.length > 0) return res(frames.shift());
              waiters.push({ res, rej });
              setTimeout(() => rej(new Error("frame timeout")), 10000);
            }),
          sendText: (text) => socket.write(encodeClientFrame(text)),
          close: () => socket.destroy(),
        });
      }
      for (;;) {
        const frame = readServerFrame(buffer);
        if (frame === null) break;
        buffer = buffer.subarray(frame.size);
        if (frame.text !== null) {
          const waiter = waiters.shift();
          if (waiter) waiter.res(frame.text);
          else frames.push(frame.text);
        }
      }
    });
    socket.on("error", reject);
    socket.on("close", () => {
      for (const w of waiters) w.rej(new Error("socket closed"));
      waiters = [];
    });
  });
}

function readServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  const payload = buffer.subarray(offset, offset + length);
  return { size: offset + length, text: opcode === 0x1 ? payload.toString("utf8") : null };
}

function encodeClientFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  let head;
  if (payload.length < 126) head = Buffer.from([0x81, 0x80 | payload.length]);
  else if (payload.length <= 0xffff) head = Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 127]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
  return Buffer.concat([head, mask, masked]);
}

(async () => {
  let ws = null;
  const child = spawn(process.execPath, [path.join(__dirname, "..", "..", "out", "headless", "index.js"), "--port", String(PORT), "--user-data", userData], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stdout += c));
  try {
    // 1. Сервер поднялся и напечатал URL+PIN.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`headless did not start: ${stdout}`)), 30000);
      child.stdout.on("data", function check() {
        if (stdout.includes("PiWright web: http://")) {
          clearTimeout(timer);
          child.stdout.removeListener("data", check);
          resolve();
        }
      });
    });
    console.log("startup:", stdout.split("\r\n")[0].trim());

    // 2. Статика: index.html без логина → 303; с cookie → 200 + title.
    const anon = await get(PORT, "/");
    const login = await postLogin(PORT, PIN);
    const cookie = (login.setCookie.find((c) => c.startsWith("pi_remote=")) ?? "").split(";")[0];
    if (!cookie) throw new Error("no pi_remote cookie after login");
    const index = await get(PORT, "/", cookie);
    const assetPath = "/assets/" + fs.readdirSync(path.join(__dirname, "..", "..", "out", "renderer", "assets")).find((f) => f.startsWith("index-") && f.endsWith(".css"));
    const asset = await get(PORT, assetPath, cookie);
    const staticOk = anon.status === 303 && index.status === 200 && index.body.includes("<title>PiWright</title>") && asset.status === 200 && asset.type.includes("text/css");
    console.log("static:", JSON.stringify({ anon: anon.status, index: index.status, asset: asset.status, type: asset.type, ok: staticOk }));

    // 3. WS-RPC: hello → invoke app:version / settings:get / неизвестный канал.
    ws = await wsConnect(PORT, cookie);
    const hello = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 1, channel: "app:version", args: [] }));
    const result1 = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 2, channel: "settings:get", args: [] }));
    const result2 = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 3, channel: "no:such-channel", args: [] }));
    const result3 = JSON.parse(await ws.nextFrame());
    console.log("rpc:", JSON.stringify({ hello, version: result1.value, theme: result2.value?.theme, unknownOk: result3.ok }));

    const rpcOk =
      hello.t === "hello" &&
      typeof result1.value === "string" &&
      result1.value.length > 0 &&
      result2.ok === true &&
      typeof result2.value.theme === "string" &&
      result3.ok === false;

    // 4. SIGINT → чистое завершение (код 0). Windows: kill('SIGINT') чужого процесса —
    // TerminateProcess без доставки сигнала (handler не вызывается) — чистый выход проверяется на posix.
    const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGINT");
    const exit = await exited;
    const signalOk = process.platform === "win32" ? exit.signal !== null || exit.code === 0 : exit.code === 0;
    console.log("shutdown:", JSON.stringify({ ...exit, ok: signalOk, platform: process.platform }));

    console.log(staticOk && rpcOk && signalOk ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = staticOk && rpcOk && signalOk ? 0 : 1;
  } finally {
    if (ws !== null) ws.close();
    try {
      child.kill("SIGKILL");
    } catch {
      // уже вышел
    }
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      // tmp
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
