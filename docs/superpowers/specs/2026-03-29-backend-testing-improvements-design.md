# Backend Testing Improvements

Comprehensive test coverage for the three backbone packages: `credstore`, `store`, and `session`.

## 1. credstore

### Refactoring

Add injectable command execution to `Resolver` so PM CLI calls can be intercepted in tests:

```go
type Resolver struct {
    runCmd   func(ctx context.Context, name string, args ...string) ([]byte, error)
    lookPath func(name string) (string, error)
}
```

`NewResolver()` wires in the real `exec.CommandContext`/`exec.LookPath`. Tests inject fakes that record args and return canned output. Package-level functions (`Check`, `Fetch`) delegate to an internal default resolver or are updated to use the resolver methods as the primary path.

### Tests

**Pure logic (no fakes):**
- `isKeychainUnavailable` — table-driven: nil, matching strings ("org.freedesktop.secrets", "no such interface", "connection refused"), non-matching error
- `Fetch` dispatch — unsupported source returns error
- `Resolver.Resolve` dispatch — unsupported source returns error

**Vault round-trip (in-memory `SecretStore` fake):**
- `VaultStoreSecret` -> `VaultGetSecret` round-trip with real `vault.Encrypt`/`vault.Decrypt`
- `VaultGetSecret` with nil nonce returns `("", nil)`
- `VaultDeleteSecret` removes the entry
- `VaultStoreSecret` with bad key returns wrapped error

**InlineSecret fallback:**
- Keychain has value -> returns it
- Keychain empty -> returns fallback
- Keychain error -> returns fallback (not error)

**PM CLI argument construction (injectable runner):**
- 1Password with `op://` URI -> args are `["read", ref]`
- 1Password without prefix -> args are `["item", "get", ref, "--fields", "label=password", "--reveal"]`
- Bitwarden basic -> args are `["get", "password", ref]`
- Bitwarden with session key -> `--session` appended
- CLI not found -> returns install error
- Context cancelled -> returns context error
- Non-zero exit -> returns stderr content

**PM status checks (injectable runner):**
- `check1Password`: CLI missing, non-zero exit, empty accounts array, valid accounts
- `checkBitwarden`: CLI missing, status parse failure, locked status, unlocked

## 2. store

### Bug fix: `GetHostsByGroup` column mismatch

Current query selects 12 columns; `ListHosts` selects 22. Missing: `key_path`, `credential_source`, `credential_ref`, `jump_host_id`, and all 6 reconnect override columns. Fix by aligning the SELECT and scan logic with `ListHosts`, reusing `scanColorTags` and `scanReconnectFields`.

### Test infrastructure

Extend `fakeResolver` to implement `VaultCredentialResolver` with in-memory maps. Add `newTestStoreWithVault` helper that calls `SetVaultKeyFunc` with a static test key.

### Tests

**Group CRUD:**
- `TestAddGroup` — name, auto-incrementing sort_order
- `TestListGroups` — ordered by sort_order
- `TestListGroups_EmptyReturnsSlice` — nil-safety
- `TestUpdateGroup` — name, sort_order, terminal profile assignment
- `TestDeleteGroup` — removed from list, hosts with that group_id still exist
- `TestAddGroup_SortOrderAfterDeletion` — sort_order continues incrementing

**Terminal Profile CRUD:**
- `TestAddProfile` — field round-trip including `CursorBlink` bool<->int conversion
- `TestListProfiles` — returns all
- `TestUpdateProfile` — field mutation
- `TestDeleteProfile` — removed from list

**Vault integration:**
- `TestAddHost_VaultEnabled` — password stored via `StoreEncryptedSecret`, not keychain
- `TestAddHost_VaultKeyError_Rollback` — host row deleted when vault encrypt fails
- `TestGetHostForConnect_VaultPath` — retrieves and decrypts from vault
- `TestGetHostForConnect_VaultLocked` — `vaultKey` returns error, propagated
- `TestGetHostForConnect_VaultNoSecret_FallsToKeychain` — nil nonce falls through

**UpdateHost credential cleanup:**
- `TestUpdateHost_InlineToExternalPM_ClearsKeychainAndVault` — both `DeleteSecret` and `DeleteEncryptedSecret` called
- `TestUpdateHost_PasswordToAgent_ClearsPasswordEntries`
- `TestUpdateHost_KeyToPassword_ClearsPassphraseEntries`

**Encrypted secret table:**
- `TestStoreEncryptedSecret_RoundTrip`
- `TestGetEncryptedSecret_NotFound` — returns `(nil, nil, nil)`
- `TestDeleteEncryptedSecret`
- `TestListEncryptedSecrets`

**Vault meta:**
- `TestSaveVaultMeta_RoundTrip`
- `TestGetVaultMeta_Empty` — returns `(nil, nil)`
- `TestDeleteVaultMeta_ClearsSecretsAndMeta` — both tables empty after

**MigratePasswordsToKeychain:**
- `TestMigratePasswordsToKeychain` — password moved to keychain, column NULLed, flag set
- `TestMigratePasswordsToKeychain_KeychainUnavailable` — skips without marking migrated
- `TestMigratePasswordsToKeychain_AlreadyMigrated` — no-op

**GetHostsByGroup (validates column fix):**
- `TestGetHostsByGroup` — returns hosts with all fields populated
- `TestGetHostsByGroup_Empty` — returns empty slice

**Other gaps:**
- `TestFindHostID` — found and not-found
- `TestListInlinePasswordHostIDs` — filters by auth_method and credential_source

## 3. session

### Test infrastructure

New `helpers_test.go` in `package session` (white-box):

- **`stubEmitter`** — implements `EventEmitter`, records all `Emit(topic, data)` calls for assertion
- **`stubDebugEmitter`** — implements `DebugEmitter`, no-op or recording
- **`newTestManager`** — creates `Manager` with stub emitter, test config, cancellable context; returns manager + cancel + emitter
- **`killableSSHServer`** — wraps `newTestSSHServer` with ability to drop all connections on demand (close listener + active conns) for reconnect tests

### Tests

**Pure functions (`session_test.go`):**
- `TestSafeFilename` — table-driven: normal string, empty -> "session", >40 chars truncated, all special chars -> "session", mixed content

**ResolveReconnectConfig (`reconnect_test.go`):**
- Extend existing test to cover all 6 host override pointer fields

**ConnectOrReuse concurrency (`connection_test.go`, white-box):**
- `TestConnectOrReuse_ReusesExistingConnection` — same host identity returns same connection ID
- `TestConnectOrReuse_InFlightDedup` — two goroutines dial simultaneously, only one `Dial` executes
- `TestConnectOrReuse_CleanedUpConnectionRedials` — torn-down connection causes fresh dial

**markDead generation guard (`reconnect_test.go`, white-box):**
- `TestMarkDead_FirstCallerWins` — two concurrent calls, only one transitions to `stateReconnecting`
- `TestMarkDead_StaleGeneration` — old generation is a no-op
- `TestMarkDead_ReconnectDisabled` — immediately `stateFailed`, closes `reconnectDone`

**reconnectLoop (`reconnect_test.go`, white-box):**
- `TestReconnectLoop_Success` — server drops, comes back, channels restored, events in correct order
- `TestReconnectLoop_ExhaustsRetries` — server stays down, emits `StatusFailed` after max retries
- `TestReconnectLoop_AllChannelsClosedAbort` — close all channels during reconnect, loop aborts
- `TestReconnectLoop_ManagerContextCancelled` — cancel manager context during backoff, loop exits

**startKeepAlive (`reconnect_test.go`, white-box):**
- `TestStartKeepAlive_MissedPingsCallMarkDead` — killable server, markDead after `KeepAliveMaxMissed` failures
- `TestStartKeepAlive_SuccessResetsMissCounter` — interleave success/failure, no markDead

**extractTarGz path traversal (`sftp_test.go`):**
- `TestExtractTarGz_Normal` — valid archive extracts correctly
- `TestExtractTarGz_PathTraversal` — archive with `../../etc/passwd` rejected
