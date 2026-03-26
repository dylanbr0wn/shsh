# shsh

A cross-platform SSH client desktop app built with [Wails v2](https://wails.io) (Go backend + React/TypeScript frontend).

## Features

- **Terminal sessions** -- connect to SSH hosts with a full terminal emulator
- **SFTP file browser** -- browse, upload, download, and transfer files between local and remote hosts
- **Port forwarding** -- manage local port forwards per connection
- **Host management** -- organize hosts into groups, import from `~/.ssh/config`, quick-connect by address
- **Credential store** -- integrate with system password managers for key passphrases and passwords
- **SSH key generation** -- generate Ed25519/RSA keys and deploy public keys to hosts
- **Session logging** -- record and review terminal session transcripts
- **Terminal profiles** -- customizable terminal appearance settings
- **Workspace templates** -- save and restore multi-tab layouts
- **Bulk connect** -- open all hosts in a group at once
- **Host ping** -- check reachability of hosts
- **Auto-reconnect** -- configurable backoff and keep-alive for dropped connections

## Development

### Prerequisites

- [Go 1.25+](https://go.dev/dl/)
- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/)
- [Wails CLI v2](https://wails.io/docs/gettingstarted/installation)

### Run

```bash
wails dev          # Hot reload (Go + React)
```

### Build

```bash
wails build        # Production build -- output binary in build/bin/
```

### Test

```bash
go test ./internal/... -race -timeout 60s   # Go tests
go vet ./internal/...                       # Static analysis
cd frontend && pnpm lint                    # ESLint
cd frontend && pnpm build                   # TypeScript check + Vite build
```

## Architecture

```
app.go              # Wails App struct -- all methods exposed to the frontend
internal/
  config/           # App configuration
  credstore/        # Password manager integration
  debuglog/         # Debug logging
  export/           # Host export/import
  session/          # SSH session, SFTP, and port forwarding management
  sshconfig/        # ~/.ssh/config parsing
  store/            # SQLite persistence (hosts, groups, profiles, templates)
frontend/           # React + TypeScript UI (Vite, shadcn/ui)
  wailsjs/          # Auto-generated Wails bindings (do not edit)
```

## License

MIT
