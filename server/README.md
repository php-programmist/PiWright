# piwright-server

Headless web server for [PiWright](https://github.com/php-programmist/PiWright) — the desktop
workbench for the [pi coding agent](https://github.com/badlogic/pi-mono). Runs as a plain Node.js
process (no Electron) and serves the full PiWright UI in a browser over WebSocket RPC with
PIN-based authentication.

## Requirements

- Node.js >= 20
- The `pi` CLI installed on the server machine (the agent binary PiWright talks to), e.g.
  `~/.local/bin/pi` on Linux/macOS.

## Install

```sh
npm install -g piwright-server
```

Or run without installing:

```sh
npx piwright-server
```

On Linux the `node-pty` dependency compiles from source when no prebuilt binary matches —
make sure build tools are available (Debian/Ubuntu: `sudo apt install build-essential`).

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

## License

MIT
