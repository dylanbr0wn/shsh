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

## Development Workflow

### Starting any feature or fix

1. Read the GitHub issue first: `gh issue view <N> --repo dylanbr0wn/shsh`
2. Check out a branch: `git checkout -b <type>/<issue>-<short-slug>`
   - Branch types: `feat`, `fix`, `chore`, `refactor`, `docs`
   - Examples: `feat/12-proxyjump`, `fix/8-reconnect-race`, `chore/1-rename-module`
3. Read **all files you will modify** before writing a single line
4. Establish a clean baseline: `go test ./...`

### Commit format

```
<type>(<scope>): <imperative summary>

<optional why>

Closes #<issue>
```

Scopes: `session`, `sftp`, `portforward`, `store`, `config`, `ui`, `sidebar`, `modal`, `keygen`, `sshconfig`, `build`

The `Closes #N` footer is required — it auto-closes the GitHub issue on merge.

### After changing Go methods on the App struct

**Always** run `wails build` to regenerate `frontend/wailsjs/go/`. Never edit those files manually.

### Pre-PR checklist

Before running `gh pr create`, all of these must pass:

```bash
go test ./...
cd frontend && pnpm build
cd frontend && pnpm lint
cd frontend && pnpm format:check
```

The PR body must include `Closes #<issue-number>` and a screenshot if any UI changed.

### Reviewing a PR

```bash
gh pr view <N> --repo dylanbr0wn/shsh
gh pr diff <N> --repo dylanbr0wn/shsh
gh pr checks <N> --repo dylanbr0wn/shsh
```

Read the changed files in full context (not just diff lines) before commenting. Post inline comments via `gh api repos/dylanbr0wn/shsh/pulls/<N>/comments`.