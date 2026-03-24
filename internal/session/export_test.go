package session

import (
	"sync"

	"github.com/melbahja/goph"
	"golang.org/x/crypto/ssh"
)

// Test-only exports for white-box testing of ref count internals.

func (m *Manager) Mu() *sync.Mutex                               { return &m.mu }
func (m *Manager) IncrClientRefs(c *goph.Client, j *ssh.Client) { m.incrClientRefs(c, j) }
func (m *Manager) ReleaseClient(c *goph.Client, j *ssh.Client)  { m.releaseClient(c, j) }
func (m *Manager) ClientRefCount(c *goph.Client) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.clientRefs[c]
}
