> [!WARNING]
> Every file in this repository – code, data, README, everything – was written by Claude (Anthropic's AI). No line was written by a human. Use at your own risk.

# RandomPortGen

Website that picks a random port for your next project, so you never have to think about which one to use. The interface is in German.

## Features

- Range presets (safe 1024–32767, registered, dynamic) or your own range
- Several ports at once, optionally consecutive
- Fixed ports per project name: the same name always gives the same ports
- Skips well-known ports (3000, 5432, 8080 …), ports browsers block, ports you already used and the system's ephemeral range
- Checks whether a port is free and replaces taken ones
- Snippets for `.env`, Docker, Compose, Vite, Node, Python and check commands
- Port lookup: range, typical service, browser block, status and the process using it
- History of generated ports

## Usage

For a real port scan, start the local server and open http://localhost:27183:

```
node server.js
```

It needs only Node.js, no packages. The server listens on 127.0.0.1 only and also reads the port ranges Windows reserves for Hyper-V, WSL and Docker.

Without the server, `index.html` works on its own (for example on GitHub Pages). The browser can then only tell whether a port is *probably* free.

Plain-text API while the server runs:

```
curl "http://localhost:27183/api/port?count=3&min=1024&max=32767"
```
