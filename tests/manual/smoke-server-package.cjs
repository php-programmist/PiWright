/* Manual smoke: piwright-server npm package (dist-server/). Checks the real install path:
   (1) npm pack dist-server → tarball, (2) clean install into a tmp prefix (deps from the
   registry, bundled electron/electron-updater stubs), (3) the .bin shim starts the server,
   (4) PIN login → cookie → WS /rpc → hello + invoke round-trips (app:version equals the
   package version, settings:get), (5) unknown channel fails.
   Launch: node tests/manual/smoke-server-package.cjs  (needs network for deps install). */
const { spawn, spawnSync } = require("child_process");
const http = require("http");
const net = require("net");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..", "..");
const distServer = path.join(root, "dist-server");
const PORT = Number(process.env.SMOKE_PORT || 7793);
const PIN = "456456";

if (!fs.existsSync(path.join(distServer, "package.json"))) {
  console.log("dist-server missing — assembling");
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "build-server-package.cjs")], { stdio: "inherit" });
  if (r.status !== 0) process.exit(1);
}
const expectedVersion = JSON.parse(fs.readFileSync(path.join(distServer, "package.json"), "utf8")).version;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "piwright-server-pkg-"));
const prefix = path.join(tmp, "prefix");
const userData = path.join(tmp, "userdata");
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, "settings.json"), JSON.stringify({ notifications: { remote: { staticPin: PIN } } }), "utf8");

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

function get(port, reqPath, cookie) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: reqPath, headers: cookie ? { Cookie: cookie } : {} },
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

function run(cmd, args, cwd) {
  // Windows: npm — npm.cmd, без shell spawnSync даёт EINVAL (блок .cmd после CVE-2024-27980);
  // команда одной строкой без args-массива — без DEP0190.
  const full = process.platform === "win32" ? `${cmd} ${args.map((a) => `"${a}"`).join(" ")}` : [cmd, ...args].join(" ");
  const r = spawnSync(full, { cwd, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`${full} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout.toString();
}

(async () => {
  let ws = null;
  let child = null;
  try {
    // 1. npm pack → tarball; 2. чистая установка в tmp-префикс (депсы из registry).
    const packOut = run("npm", ["pack", distServer], tmp);
    const tarballName = packOut.trim().split(/\r?\n/).pop().trim();
    const tarball = path.join(tmp, tarballName);
    if (!fs.existsSync(tarball)) throw new Error(`npm pack did not produce ${tarballName}`);
    console.log("tarball:", tarballName);
    console.log("installing into clean prefix (deps from registry)...");
    run("npm", ["install", "--prefix", prefix, tarball], tmp);
    const pkgDir = path.join(prefix, "node_modules", "piwright-server");
    for (const rel of ["out/headless/index.js", "out/chunks", "out/daemon/index.js", "out/renderer/index.html", "node_modules/electron/index.js", "node_modules/electron-updater/index.js"]) {
      if (!fs.existsSync(path.join(pkgDir, rel))) throw new Error(`package is missing ${rel}`);
    }
    console.log("installed:", expectedVersion);

    // 3. Запуск через .bin-шим (как после npm i -g). Windows: cmd.exe /c вместо shell:true —
    // иначе DEP0190 и kill('SIGKILL') убивает cmd-обёртку, а не node-сервер (процесс-сирота).
    const binName = process.platform === "win32" ? "piwright-server.cmd" : "piwright-server";
    const shim = path.join(prefix, "node_modules", ".bin", binName);
    if (!fs.existsSync(shim)) throw new Error(`missing .bin shim: ${shim}`);
    const spawnCmd = process.platform === "win32" ? "cmd.exe" : shim;
    const spawnArgs = process.platform === "win32" ? ["/d", "/s", "/c", shim, "--port", String(PORT), "--user-data", userData] : ["--port", String(PORT), "--user-data", userData];
    child = spawn(spawnCmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stdout += c));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start: ${stdout}`)), 30000);
      child.stdout.on("data", function check() {
        if (stdout.includes("PiWright web: http://")) {
          clearTimeout(timer);
          child.stdout.removeListener("data", check);
          resolve();
        }
      });
    });
    console.log("startup:", stdout.split("\r\n")[0].trim());

    // 4. PIN-логин → статика → WS round-trip.
    const login = await postLogin(PORT, PIN);
    const cookie = (login.setCookie.find((c) => c.startsWith("pi_remote=")) ?? "").split(";")[0];
    if (!cookie) throw new Error(`no pi_remote cookie after login (status ${login.status})`);
    const index = await get(PORT, "/", cookie);
    const assetPath = "/assets/" + fs.readdirSync(path.join(pkgDir, "out", "renderer", "assets")).find((f) => f.startsWith("index-") && f.endsWith(".css"));
    const asset = await get(PORT, assetPath, cookie);
    const staticOk = index.status === 200 && index.body.includes("<title>PiWright</title>") && asset.status === 200;
    console.log("static:", JSON.stringify({ index: index.status, asset: asset.status, ok: staticOk }));

    ws = await wsConnect(PORT, cookie);
    const hello = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 1, channel: "app:version", args: [] }));
    const result1 = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 2, channel: "settings:get", args: [] }));
    const result2 = JSON.parse(await ws.nextFrame());
    ws.sendText(JSON.stringify({ t: "invoke", id: 3, channel: "no:such-channel", args: [] }));
    const result3 = JSON.parse(await ws.nextFrame());
    console.log("rpc:", JSON.stringify({ helloVersion: hello.version, appVersion: result1.value, theme: result2.value?.theme, unknownOk: result3.ok === false }));

    const rpcOk =
      hello.t === "hello" &&
      hello.version === expectedVersion &&
      result1.ok === true &&
      result1.value === expectedVersion &&
      result2.ok === true &&
      typeof result2.value.theme === "string" &&
      result3.ok === false;

    console.log(staticOk && rpcOk ? "SMOKE OK" : "SMOKE FAIL");
    process.exitCode = staticOk && rpcOk ? 0 : 1;
  } finally {
    if (ws !== null) ws.close();
    if (child !== null) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
      else {
        try {
          child.kill("SIGKILL");
        } catch {
          // уже вышел
        }
      }
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // tmp
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
