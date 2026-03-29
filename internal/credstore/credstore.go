// Package credstore provides integration with external password managers.
// It handles fetching SSH credentials from 1Password and Bitwarden CLIs
// at connect time, so secrets never need to be stored by shsh directly.
package credstore

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

// Source identifies where a host's password credential comes from.
type Source string

const (
	// SourceInline means the password is stored in the OS keychain by shsh
	// (the default, current behaviour).
	SourceInline    Source = "inline"
	Source1Password Source = "1password"
	SourceBitwarden Source = "bitwarden"
)

// PMStatus describes the availability of a password manager CLI.
type PMStatus struct {
	Available bool   `json:"available"`
	Locked    bool   `json:"locked"`
	Error     string `json:"error,omitempty"`
}

// PasswordManagersStatus holds the status of each supported external PM.
type PasswordManagersStatus struct {
	OnePassword PMStatus `json:"onePassword"`
	Bitwarden   PMStatus `json:"bitwarden"`
}

// defaultResolver is used by package-level convenience functions.
var defaultResolver = NewResolver()

// Check returns the current availability and lock status of each supported PM.
func Check() PasswordManagersStatus {
	return defaultResolver.Check()
}

// FetchFrom1Password retrieves the password field of a 1Password item.
// ref can be an item UUID, name, or a `op://vault/item/field` URI.
func FetchFrom1Password(ref string) (string, error) {
	return defaultResolver.fetchFrom1PasswordCtx(context.Background(), ref)
}

// FetchFromBitwarden retrieves the password of a Bitwarden vault item.
// ref is the item name or UUID.
func FetchFromBitwarden(ref string) (string, error) {
	return defaultResolver.fetchFromBitwardenCtx(context.Background(), ref)
}

// Fetch retrieves a credential from the given external source using ref.
// source must be Source1Password or SourceBitwarden.
func Fetch(source Source, ref string) (string, error) {
	return defaultResolver.Fetch(source, ref)
}

// Check returns the current availability and lock status of each supported PM.
func (r *Resolver) Check() PasswordManagersStatus {
	return PasswordManagersStatus{
		OnePassword: r.check1Password(),
		Bitwarden:   r.checkBitwarden(),
	}
}

// Fetch retrieves a credential from the given external source using ref.
func (r *Resolver) Fetch(source Source, ref string) (string, error) {
	switch source {
	case Source1Password:
		return r.fetchFrom1PasswordCtx(context.Background(), ref)
	case SourceBitwarden:
		return r.fetchFromBitwardenCtx(context.Background(), ref)
	default:
		return "", fmt.Errorf("unsupported credential source: %s", source)
	}
}

// check1Password probes the `op` CLI.
func (r *Resolver) check1Password() PMStatus {
	if _, err := r.lookPath("op"); err != nil {
		return PMStatus{Available: false, Error: "op CLI not found"}
	}

	// `op account list --format json` exits non-zero when not signed in.
	out, err := r.runCmd(context.Background(), "op", "account", "list", "--format", "json")
	if err != nil {
		return PMStatus{Available: true, Locked: true, Error: "not signed in to 1Password"}
	}

	// Empty JSON array means no accounts.
	var accounts []json.RawMessage
	if jsonErr := json.Unmarshal(out, &accounts); jsonErr != nil || len(accounts) == 0 {
		return PMStatus{Available: true, Locked: true, Error: "no 1Password accounts found"}
	}

	return PMStatus{Available: true, Locked: false}
}

// checkBitwarden probes the `bw` CLI.
func (r *Resolver) checkBitwarden() PMStatus {
	if _, err := r.lookPath("bw"); err != nil {
		return PMStatus{Available: false, Error: "bw CLI not found"}
	}

	out, err := r.runCmd(context.Background(), "bw", "status")
	if err != nil {
		return PMStatus{Available: true, Locked: true, Error: "bw status failed"}
	}

	var status struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(out, &status); err != nil {
		return PMStatus{Available: true, Locked: true, Error: "could not parse bw status"}
	}

	if status.Status != "unlocked" {
		return PMStatus{Available: true, Locked: true, Error: "Bitwarden vault is locked"}
	}

	return PMStatus{Available: true, Locked: false}
}

// fetchFrom1PasswordCtx retrieves the password field of a 1Password item,
// respecting context for timeout.
func (r *Resolver) fetchFrom1PasswordCtx(ctx context.Context, ref string) (string, error) {
	if _, err := r.lookPath("op"); err != nil {
		return "", fmt.Errorf("1Password CLI (op) not installed")
	}

	var args []string
	if strings.HasPrefix(ref, "op://") {
		args = []string{"read", ref}
	} else {
		args = []string{"item", "get", ref, "--fields", "label=password", "--reveal"}
	}

	out, err := r.runCmd(ctx, "op", args...)
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("1Password: %w", ctx.Err())
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("1Password: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("1Password fetch failed: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}

// fetchFromBitwardenCtx retrieves the password of a Bitwarden vault item,
// respecting context for timeout.
func (r *Resolver) fetchFromBitwardenCtx(ctx context.Context, ref string) (string, error) {
	if _, err := r.lookPath("bw"); err != nil {
		return "", fmt.Errorf("Bitwarden CLI (bw) not installed")
	}

	r.bwMu.Lock()
	sessionKey := r.bwSessionKey
	r.bwMu.Unlock()

	args := []string{"get", "password", ref}
	if sessionKey != "" {
		args = append(args, "--session", sessionKey)
	}

	out, err := r.runCmd(ctx, "bw", args...)
	if err != nil {
		if ctx.Err() != nil {
			return "", fmt.Errorf("Bitwarden: %w", ctx.Err())
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("Bitwarden: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("Bitwarden fetch failed: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}
