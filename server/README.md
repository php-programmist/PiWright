# piwright-server

Headless web server for [PiWright](https://github.com/php-programmist/PiWright) — the desktop
workbench for the [pi coding agent](https://github.com/badlogic/pi-mono). Runs as a plain Node.js
process (no Electron) and serves the full PiWright UI in a browser over WebSocket RPC with
PIN-based authentication.

## Requirements

- Node.js >= 20
- The `pi` CLI installed on the server machine (the agent binary PiWright talks to), e.g.
  `~/.local/bin/pi` on Linux/macOS.
- Linux only: a C/C++ toolchain and Python >= 3.8 to compile `node-pty` (see
  [Troubleshooting](#troubleshooting)). Windows and macOS use prebuilt binaries.

## Install

```sh
npm install -g piwright-server
```

Or run without installing:

```sh
npx piwright-server
```

On Linux the `node-pty` dependency compiles from source when no prebuilt binary matches —
make sure build tools and Python >= 3.8 are available (see [Troubleshooting](#troubleshooting)).

## Run

```sh
piwright-server
```

The server prints the URL and a PIN:

```
PiWright web: http://localhost:7691/ (PIN 154 374)
```

Open the URL in a browser, enter the PIN, and you get the full PiWright workbench (projects,
sessions, chat, files, git, terminal).

### CLI flags

| Flag | Default | Description |
| --- | --- | --- |
| `--port` | `7691` | HTTP/WebSocket port |
| `--host` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN access) |
| `--user-data` | platform default | userData directory (settings, projects, sessions) |
| `--tls-cert` / `--tls-key` | off | Serve HTTPS (both flags required together) |

The default userData directory matches the PiWright desktop app
(`~/.config/piwright` on Linux, `~/Library/Application Support/piwright` on macOS,
`%APPDATA%\piwright` on Windows), so settings, projects and session history are shared with a
desktop installation for the same user. Keep the package version in sync with the desktop app
version.

### TLS for LAN access

```sh
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout key.pem -out cert.pem -subj "/CN=piwright.local"
piwright-server --host 0.0.0.0 --tls-cert cert.pem --tls-key key.pem
```

Behind a reverse proxy (TLS termination) the proxy must forward the `Host` header or set
`X-Forwarded-Host` (same-origin protection rejects mismatched origins), and upgrade
`Connection: Upgrade` for the `/rpc` WebSocket endpoint. A minimal Caddy example:

```
piwright.example.com {
    reverse_proxy 127.0.0.1:7691
}
```

## systemd

```ini
[Unit]
Description=PiWright headless web server
After=network-online.target

[Service]
ExecStart=/usr/bin/env piwright-server --host 0.0.0.0
Restart=on-failure
User=%i

[Install]
WantedBy=multi-user.target
```

Save as `/etc/systemd/system/piwright-server@.service` (template for per-user instances),
then:

```sh
sudo systemctl enable --now piwright-server@youruser
```

## launchd (macOS)

Save as `~/Library/LaunchAgents/com.piwright.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.piwright.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/piwright-server</string>
        <string>--host</string><string>0.0.0.0</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>
```

Then: `launchctl load ~/Library/LaunchAgents/com.piwright.server.plist`
(find the global bin path with `npm prefix -g`).

## Security notes

- The server is authenticated by a static PIN (cookie session after login). Set a strong PIN in
  the settings file (`notifications.remote.staticPin`) before exposing the server beyond
  localhost; changing the PIN revokes existing browser sessions.
- Without TLS the PIN and traffic travel in plaintext — use `--tls-cert/--tls-key` or a reverse
  proxy for anything beyond localhost.

## Troubleshooting

**`npx piwright-server` (or `npm install -g piwright-server`) exits silently on Linux.**
Compiling `node-pty` needs Python >= 3.8 (the node-gyp bundled with npm 10+). Distributions with
an older system Python (e.g. Ubuntu 18.04 ships 3.6) fail the build, and npx exits with code 1
without printing anything. Fix — install Python 3.8 and point node-gyp at it for the install run:

```sh
sudo apt install python3.8        # Ubuntu 18.04; newer distros already ship >= 3.8
PYTHON=$(command -v python3.8) npx -y piwright-server
```

The compiled binary is cached by npm, so subsequent runs don't need `PYTHON` until the package
is (re)installed. Also make sure a C/C++ toolchain is present (Debian/Ubuntu:
`sudo apt install build-essential`).

## License

MIT
