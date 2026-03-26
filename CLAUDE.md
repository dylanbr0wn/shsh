# CLAUDE.md

## Project Overview

Cross-platform SSH client desktop app built with **Wails v2** (Go backend + React/TypeScript frontend).

## Commands

```bash
wails dev                                    # Hot reload (Go + React)
wails build                                  # Production build
wails generate module                        # Regenerate TS bindings only

cd frontend && pnpm dev                      # Frontend dev server
cd frontend && pnpm build                    # TypeScript check + Vite build
cd frontend && pnpm lint                     # ESLint
cd frontend && pnpm format:check             # Prettier check

go test ./internal/... -race -timeout 60s    # Go tests (matches CI)
go vet ./internal/...                        # Go static analysis
govulncheck ./...                            # Vulnerability scan
```

## Architecture

Wails v2 app — Go backend process, React UI in a webview, connected via Wails RPC bindings.

- Go methods on the `App` struct (`app.go`) are exposed to the frontend
- `wails build`/`wails dev`/`wails generate module` auto-generates TypeScript bindings into `frontend/wailsjs/go/`
- `frontend/wailsjs/` is auto-generated — never edit manually
- Backend Go packages live under `internal/`

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
4. Establish a clean baseline: `go test ./internal/... -race -timeout 60s`

### Commit format

```
<type>(<scope>): <imperative summary>

<optional why>

Closes #<issue>
```

Scopes: `session`, `sftp`, `portforward`, `store`, `config`, `ui`, `sidebar`, `modal`, `keygen`, `sshconfig`, `build`

The `Closes #N` footer is required — it auto-closes the GitHub issue on merge.

### After changing Go methods on the App struct

Run `wails generate module` to regenerate `frontend/wailsjs/go/`. Never edit those files manually.

### Pre-PR checklist

Before running `gh pr create`, **all** of these must pass — they mirror CI exactly:

```bash
# Go checks
go vet ./internal/...
go test ./internal/... -race -timeout 60s
go mod tidy && git diff --exit-code go.mod go.sum   # ensure deps are clean
govulncheck ./...

# Frontend checks
cd frontend && pnpm build        # typecheck + build
cd frontend && pnpm lint
cd frontend && pnpm format:check
cd frontend && pnpm audit --audit-level=high
```

The PR body must include `Closes #<issue-number>` and a screenshot if any UI changed.

### Reviewing a PR

```bash
gh pr view <N> --repo dylanbr0wn/shsh
gh pr diff <N> --repo dylanbr0wn/shsh
gh pr checks <N> --repo dylanbr0wn/shsh
```

Read the changed files in full context (not just diff lines) before commenting.