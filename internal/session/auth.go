package session

import (
	"fmt"

	"github.com/dylanbr0wn/shsh/internal/store"
	"github.com/melbahja/goph"
)

// ResolveAuth builds a goph.Auth for the given host and secret (password or key passphrase).
func ResolveAuth(host store.Host, secret string) (goph.Auth, error) {
	switch host.AuthMethod {
	case store.AuthPassword:
		return goph.Password(secret), nil
	case store.AuthKey:
		if host.KeyPath == nil || *host.KeyPath == "" {
			return nil, fmt.Errorf("no key file configured for this host")
		}
		return goph.Key(*host.KeyPath, secret)
	case store.AuthAgent:
		return goph.UseAgent()
	default:
		agent, err := goph.UseAgent()
		if err != nil {
			return goph.Password(secret), nil
		}
		return agent, nil
	}
}
