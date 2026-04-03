---
name: pre-pr
description: Run the full pre-PR checklist (Go checks + frontend checks) that mirrors CI, and report results before creating a PR
user_invocable: true
---

# Pre-PR Checklist

Run all checks that mirror CI. Every check must pass before creating a PR.

## Steps

Run Go checks and frontend checks in parallel where possible:

### Go checks (run sequentially)
```bash
go vet ./internal/...
go test ./internal/... -race -timeout 60s
go mod tidy && git diff --exit-code go.mod go.sum
govulncheck ./...
```

### Frontend checks (run sequentially)
```bash
cd frontend && pnpm build
cd frontend && pnpm lint
cd frontend && pnpm format:check
cd frontend && pnpm test
cd frontend && pnpm audit --audit-level=high
```

## Reporting

After all checks complete, report a summary:
- List each check with pass/fail status
- For failures, show the relevant error output
- Do NOT proceed with `gh pr create` until all checks pass
- Remind the user that the PR body must include `Closes #<issue-number>` and a screenshot if any UI changed
