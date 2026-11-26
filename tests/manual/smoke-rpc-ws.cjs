/* Manual smoke: RPC transport layer. Checks (1) preload transport works in the live window
   (window.piwright over the shared factory), (2) the WS-RPC endpoint /rpc on the remote server:
   PIN login → cookie → WS upgrade → hello → invoke round-trips (app:version, settings:get).
   SMOKE_CDP=http://localhost:9223 SMOKE_PORT=7698. */
const http = require("http");
const net = require("net");
const crypto = require("crypto");
const path = require("path");
const { chromium } = require("playwright-core");

const CDP = process.env.SMOKE_CDP || "http://localhost:9223";
const PORT = Number(process.env.SMOKE_PORT || 7698);

function setRemote(page, patch) {
  return page.evaluate(async (p) => {
    const s = await window.piwright.getSettings();
    await window.piwright.setSettings({
      notifications: { ...s.notifications, remote: { ...s.notifications.remote, ...p } },
    });
  }, patch);
}

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
  else if (payload.length <= 0xffff) head = Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
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
  const browser = await chromium.connectOverCDP(CDP);
  const page = browser.contexts()[0].pages()[0];
  let ws = null;
  try {
    await page.waitForSelector("#root > *", { timeout: 30000 });

    // 1. Preload-транспорт: фабрика отдаёт рабочий API в живом окне.
    const version = await page.evaluate(() => window.piwright.appVersion());
    const settings = await page.evaluate(() => window.piwright.getSettings());
    const preloadOk = typeof version === "string" && version.length > 0 && typeof settings.theme === "string";
    console.log("preload transport:", JSON.stringify({ version, theme: settings.theme, ok: preloadOk }));

    // 2. WS-транспорт: включаем remote, логинимся по PIN, открываем /rpc.
    await setRemote(page, { enabled: true, port: PORT });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(
      (port) => window.piwright.remoteStatus().then((s) => s.running && s.port === port),
      PORT,
      { timeout: 30000 }
    );
    const remote = await page.evaluate(() => window.piwright.remoteStatus());
    console.log("remote:", JSON.stringify(remote));

    const login = await postLogin(PORT, remote.pin);
    const cookie = (login.setCookie.find((c) => c.startsWith("pi_remote=")) ?? "").split(";")[0];
    if (!cookie) throw new Error("no pi_remote cookie after login");
    ws = await wsConnect(PORT, cookie);
    const hello = JSON.parse(await ws.nextFrame());
    console.log("hello:", JSON.stringify(hello));

    ws.sendText(JSON.stringify({ t: "invoke", id: 1, channel: "app:version", args: [] }));
    const result1 = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 2, channel: "settings:get", args: [] }));
    const result2 = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 3, channel: "no:such-channel", args: [] }));
    const result3 = JSON.parse(await ws.nextFrame());
    console.log("invoke results:", JSON.stringify([result1, { ok: result2.ok, keys: Object.keys(result2.value ?? {}) }, result3]));

    const wsOk =
      hello.t === "hello" &&
      hello.version === version &&
      result1.ok === true &&
      result1.value === version &&
      result2.ok === true &&
      typeof result2.value.theme === "string" &&
      result3.ok === false;

    await page.screenshot({ path: path.join(__dirname, "rpc-ws.png") });
    console.log(preloadOk && wsOk ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = preloadOk && wsOk ? 0 : 1;
  } finally {
    if (ws !== null) ws.close();
    try {
      await setRemote(page, { enabled: false });
    } catch {
      // окно уже закрыто
    }
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
