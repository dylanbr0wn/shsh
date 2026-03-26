# Credential Resolver: Decouple store from credstore

**Issue:** [#48](https://github.com/dylanbr0wn/shsh/issues/48)
**Date:** 2026-03-25
**Branch:** `feat/credential-chain`

## Problem

`store.GetHostForConnect` hardcodes a `switch` on `CredentialSource` that directly calls `credstore.FetchFrom1Password` / `credstore.FetchFromBitwarden`. The `store` package also owns keychain helpers used in `AddHost`, `UpdateHost`, `DeleteHost`, and `MigratePasswordsToKeychain`. This means:

1. Adding a new password manager requires modifying `store.go`
2. Store tests can't exercise credential paths without an OS keychain and external CLIs
3. No timeout on external CLI calls — if `op` or `bw` hangs, the connection blocks
4. `credstore` has 0% test coverage

## Design

### CredentialResolver interface (in `store` package)

```go
// internal/store/credentials.go
type CredentialResolver interface {
    // Resolve fetches a secret from an external credential source (e.g., 1Password, Bitwarden).
    // ctx carries a timeout — implementations must use exec.CommandContext.
    Resolve(ctx context.Context, source, ref string) (string, error)

    // InlineSecret returns the locally-stored secret (OS keychain with fallback).
    InlineSecret(key, fallback string) (string, error)

    // StoreSecret persists a secret to the OS keychain.
    StoreSecret(key, value string) error

    // DeleteSecret removes a secret from the OS keychain.
    DeleteSecret(key string) error
}
```

### CredentialSource type change

`Host.CredentialSource`, `CreateHostInput.CredentialSource`, and `UpdateHostInput.CredentialSource` change from `credstore.Source` to plain `string`. The string values (`"inline"`, `"1password"`, `"bitwarden"`) are unchanged. This eliminates the `store -> credstore` import entirely.

### Store changes

`Store` gains a `credentials CredentialResolver` field. `New` signature becomes:

```go
func New(dbPath string, creds CredentialResolver) (*Store, error)
```

**`GetHostForConnect`** delegates to the interface:

```go
case AuthPassword:
    if h.CredentialSource == "inline" || h.CredentialSource == "" {
        pw, err := s.credentials.InlineSecret(id, dbPassword.String)
        return h, pw, err
    }
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    pw, err := s.credentials.Resolve(ctx, h.CredentialSource, h.CredentialRef)
    return h, pw, err
```

**`AddHost`/`UpdateHost`:** Replace `keychainSet(id, pw)` with `s.credentials.StoreSecret(id, pw)` and `keychainDelete(id)` with `s.credentials.DeleteSecret(id)`.

**`DeleteHost`:** Replace `keychainDelete(id)` / `keychainDelete(id+":passphrase")` with `s.credentials.DeleteSecret(...)`.

**`MigratePasswordsToKeychain`:** Replace `keychainSet(p.id, p.password)` with `s.credentials.StoreSecret(p.id, p.password)`. The `ErrKeychainUnavailable` check changes to `errors.Is(err, credstore.ErrKeychainUnavailable)` — wait, store shouldn't import credstore. Instead, define a sentinel `var ErrKeychainUnavailable = errors.New("keychain unavailable")` in `store/credentials.go` and have the concrete resolver wrap/return that same error. The resolver implementation returns `store.ErrKeychainUnavailable` from its `StoreSecret`/`DeleteSecret` methods.

Actually, to avoid a circular import (`credstore` imports `store` for the interface, `store` imports `credstore` for the error), the sentinel stays in `store` as it is today. The concrete `Resolver` in `credstore` returns `store.ErrKeychainUnavailable` when the keychain is unreachable. The `store` package checks `errors.Is(err, ErrKeychainUnavailable)` — no import of `credstore` needed.

### Concrete Resolver (in `credstore` package)

```go
// internal/credstore/resolver.go
type Resolver struct{}

func NewResolver() *Resolver { return &Resolver{} }

func (r *Resolver) Resolve(ctx context.Context, source, ref string) (string, error)
func (r *Resolver) InlineSecret(key, fallback string) (string, error)
func (r *Resolver) StoreSecret(key, value string) error
func (r *Resolver) DeleteSecret(key string) error
```

- `Resolve` dispatches to `fetchFrom1PasswordCtx` / `fetchFromBitwardenCtx` which use `exec.CommandContext(ctx, ...)` for timeout enforcement.
- `InlineSecret` calls `KeychainGet(key)`, falling back to `fallback` if empty/error.
- `StoreSecret` calls `KeychainSet(key, value)`, mapping keychain-unavailable errors to `store.ErrKeychainUnavailable`.
- `DeleteSecret` calls `KeychainDelete(key)`, same error mapping.

### Keychain helpers move to `credstore/keychain.go`

`keychainGet`/`keychainSet`/`keychainDelete` and `isKeychainUnavailable` move from `internal/store/keychain.go` to `internal/credstore/keychain.go` and are exported as `KeychainGet`, `KeychainSet`, `KeychainDelete`. The `store/keychain.go` file is deleted.

`ErrKeychainUnavailable` stays in `store/credentials.go` (avoids circular import). The credstore keychain helpers return `store.ErrKeychainUnavailable` when the OS keychain is unreachable.

### Wiring (app.go)

```go
s, err := store.New(dbPath, credstore.NewResolver())
```

### Files to create

| File | Contents |
|------|----------|
| `internal/store/credentials.go` | `CredentialResolver` interface, `ErrKeychainUnavailable` sentinel |
| `internal/credstore/resolver.go` | `Resolver` struct implementing `store.CredentialResolver` |
| `internal/credstore/keychain.go` | Exported keychain helpers (moved from `store/keychain.go`) |

### Files to modify

| File | Changes |
|------|---------|
| `internal/store/store.go` | Add `credentials` field, update `New` signature, rewrite `GetHostForConnect`, replace all `keychainSet`/`keychainGet`/`keychainDelete` calls with `s.credentials.*`, change `CredentialSource` fields from `credstore.Source` to `string`, remove `credstore` import |
| `internal/credstore/credstore.go` | Add context-aware `fetchFrom1PasswordCtx`/`fetchFromBitwardenCtx`, keep existing `FetchFrom1Password`/`FetchFromBitwarden` as wrappers (or remove if unused elsewhere) |
| `app.go` | Pass `credstore.NewResolver()` to `store.New` |
| `internal/store/store_test.go` | Add `fakeResolver`, update `newTestStore`, add credential-path tests |

### Files to delete

| File | Reason |
|------|--------|
| `internal/store/keychain.go` | Moved to `internal/credstore/keychain.go` |

### Files unchanged

| File | Reason |
|------|--------|
| `internal/session/auth.go` | Already receives `(host, secret)`, no coupling to credstore |
| `internal/deps/deps.go` | Resolver is internal to Store, not a Deps field |

## Test Plan

### store_test.go

- `fakeResolver` struct implementing `CredentialResolver` with canned returns and call recording
- `TestGetHostForConnect_InlineKeychain` — inline source delegates to `InlineSecret`
- `TestGetHostForConnect_ExternalPM` — non-inline source delegates to `Resolve`
- `TestGetHostForConnect_KeychainUnavailable` — `InlineSecret` returns error, falls back to DB password
- `TestGetHostForConnect_ExternalPMTimeout` — `Resolve` returns context deadline exceeded error
- `TestAddHost_StoresSecret` — verifies `StoreSecret` called for password auth
- `TestDeleteHost_DeletesSecrets` — verifies `DeleteSecret` called for both password and passphrase keys

### credstore/resolver_test.go

- Unit tests for `InlineSecret` with keychain available/unavailable scenarios
- Unit tests for `StoreSecret`/`DeleteSecret` error mapping
