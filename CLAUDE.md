# Claude

## Skills

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

## Code Changes Workflow

- When removing a variable/ref/prop, grep the entire codebase for remaining references before considering the change done.

## Fix Strategy

When fixing bugs, prefer the simplest fix that doesn't change API signatures or return types. Changing Go backend return types can break frontend rendering. If a deeper fix is needed, explicitly flag the blast radius before proceeding.

## LSP Diagnostics

Stale LSP diagnostics may show false errors. If diagnostics report errors but the code compiles and tests pass, trust the build output over LSP. Do not 'fix' code based solely on stale diagnostics.
