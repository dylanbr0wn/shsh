// Package credstore provides integration with external password managers.
// It handles fetching SSH credentials from 1Password and Bitwarden CLIs
// at connect time, so secrets never need to be stored by shsh directly.
package credstore

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
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

// mu guards bwSessionKey.
var mu sync.Mutex

// bwSessionKey caches the Bitwarden session key for the lifetime of the app.
var bwSessionKey string

// Check returns the current availability and lock status of each supported PM.
func Check() PasswordManagersStatus {
	return PasswordManagersStatus{
		OnePassword: check1Password(),
		Bitwarden:   checkBitwarden(),
	}
}

// check1Password probes the `op` CLI.
func check1Password() PMStatus {
	if _, err := exec.LookPath("op"); err != nil {
		return PMStatus{Available: false, Error: "op CLI not found"}
	}

	// `op account list --format json` exits non-zero when not signed in.
	out, err := exec.Command("op", "account", "list", "--format", "json").Output()
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
func checkBitwarden() PMStatus {
	if _, err := exec.LookPath("bw"); err != nil {
		return PMStatus{Available: false, Error: "bw CLI not found"}
	}

	out, err := exec.Command("bw", "status").Output()
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

// FetchFrom1Password retrieves the password field of a 1Password item.
// ref can be an item UUID, name, or a `op://vault/item/field` URI.
func FetchFrom1Password(ref string) (string, error) {
	if _, err := exec.LookPath("op"); err != nil {
		return "", fmt.Errorf("1Password CLI (op) not installed")
	}

	// Support `op://` URIs directly; otherwise use `op item get` with --fields.
	var args []string
	if strings.HasPrefix(ref, "op://") {
		args = []string{"read", ref}
	} else {
		args = []string{"item", "get", ref, "--fields", "label=password", "--reveal"}
	}

	out, err := exec.Command("op", args...).Output() //nolint:gosec
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("1Password: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("1Password fetch failed: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}

// FetchFromBitwarden retrieves the password of a Bitwarden vault item.
// ref is the item name or UUID.
func FetchFromBitwarden(ref string) (string, error) {
	if _, err := exec.LookPath("bw"); err != nil {
		return "", fmt.Errorf("Bitwarden CLI (bw) not installed")
	}

	mu.Lock()
	sessionKey := bwSessionKey
	mu.Unlock()

	args := []string{"get", "password", ref}
	if sessionKey != "" {
		args = append(args, "--session", sessionKey)
	}

	out, err := exec.Command("bw", args...).Output() //nolint:gosec
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("Bitwarden: %s", strings.TrimSpace(string(exitErr.Stderr)))
		}
		return "", fmt.Errorf("Bitwarden fetch failed: %w", err)
	}

	return strings.TrimSpace(string(out)), nil
}

// SetBitwardenSessionKey caches a Bitwarden session key for the app lifetime.
// Call this after the user has unlocked the vault with `bw unlock`.
func SetBitwardenSessionKey(key string) {
	mu.Lock()
	defer mu.Unlock()
	bwSessionKey = key
}
