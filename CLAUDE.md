# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A cross-platform SSH client desktop app built with **Wails v2** (Go backend + React/TypeScript frontend). The goal is a pleasant SSH client with host saving, multi-session support, SFTP, SSH config tools, password manager integration, theming, and credential saving.

## Commands

**Development (hot reload for both Go and React):**
```bash
wails dev
```

**Production build:**
```bash
wails build
```

**Frontend only (from `frontend/` directory):**
```bash
pnpm dev        # Vite dev server
pnpm build      # TypeScript + Vite production build
```

**Go tests:**
```bash
go test ./...
go test ./... -run TestName   # single test
```

## Architecture

This is a Wails v2 app — Go is the backend process, React is the UI rendered in a webview. Communication between them uses **Wails RPC bindings**:

- Go methods on the `App` struct (`app.go`) are exposed to the frontend
- `wails build`/`wails dev` auto-generates TypeScript bindings into `frontend/wailsjs/go/`
- Import and call Go methods from React like: `import { Greet } from '../wailsjs/go/main/App'`

The Wails runtime (`frontend/wailsjs/runtime/`) provides window management, events, and dialogs from the frontend side.

**Backend entry points:**
- `main.go` — app configuration, window setup, binding the `App` struct
- `app.go` — `App` struct with `startup()` lifecycle hook and all Go methods callable from the frontend

**Frontend entry points:**
- `frontend/src/main.tsx` — React root
- `frontend/src/App.tsx` — top-level component

**Key constraint:** `frontend/wailsjs/` is auto-generated — do not edit these files manually. Re-run `wails dev` or `wails build` to regenerate after changing Go method signatures.

## Frontend Development Guidelines

When making any frontend/React changes:
- Always use the `shadcn` skill for component work and UI building
- Always use the `web-design-guidelines` skill when reviewing or auditing UI
- Apply `vercel-react-best-practices` for performance-sensitive work