.PHONY: dev build generate test vet vulncheck lint format-check audit frontend-build check pre-pr

# Development
dev:
	wails dev

build:
	wails build

generate:
	wails generate module

# Go checks
test:
	go test ./internal/... -race -timeout 60s

vet:
	go vet ./internal/...

vulncheck:
	govulncheck ./...

tidy:
	go mod tidy

# Frontend checks
frontend-build:
	cd frontend && pnpm build

lint:
	cd frontend && pnpm lint

format-check:
	cd frontend && pnpm format:check

audit:
	cd frontend && pnpm audit --audit-level=high

# Combined checks
check: vet test tidy vulncheck frontend-build lint format-check audit

pre-pr: check
	@git diff --exit-code go.mod go.sum || (echo "go.mod/go.sum have uncommitted changes after tidy" && exit 1)
