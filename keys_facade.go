package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dylanbr0wn/shsh/internal/deps"
	"github.com/dylanbr0wn/shsh/internal/session"

	"github.com/melbahja/goph"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

// GenerateKeyInput holds the parameters for SSH key pair generation.
type GenerateKeyInput struct {
	KeyType    string `json:"keyType"`    // "ed25519" or "rsa"
	RSABits    int    `json:"rsaBits"`    // 2048 or 4096 (RSA only)
	SavePath   string `json:"savePath"`   // full path for the private key
	Passphrase string `json:"passphrase"` // optional encryption passphrase
	Comment    string `json:"comment"`    // appended to the public key line
}

// GenerateKeyResult holds the paths and public key text after generation.
type GenerateKeyResult struct {
	PrivateKeyPath string `json:"privateKeyPath"`
	PublicKeyPath  string `json:"publicKeyPath"`
	PublicKeyText  string `json:"publicKeyText"`
}

// KeysFacade handles SSH key generation, deployment, and file browsing.
type KeysFacade struct {
	d *deps.Deps
}

// NewKeysFacade creates a new KeysFacade.
func NewKeysFacade(d *deps.Deps) *KeysFacade {
	return &KeysFacade{d: d}
}

// GenerateSSHKey generates a new SSH key pair and writes both files to disk.
func (f *KeysFacade) GenerateSSHKey(input GenerateKeyInput) (GenerateKeyResult, error) {
	// Expand ~ in save path
	if strings.HasPrefix(input.SavePath, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("resolve home directory: %w", err)
		}
		input.SavePath = filepath.Join(home, input.SavePath[2:])
	}
	if input.SavePath == "" {
		return GenerateKeyResult{}, fmt.Errorf("save path is required")
	}

	// Ensure the directory exists
	if err := os.MkdirAll(filepath.Dir(input.SavePath), 0700); err != nil {
		return GenerateKeyResult{}, fmt.Errorf("create directory: %w", err)
	}

	var privBlock *pem.Block
	var sshPub ssh.PublicKey

	switch input.KeyType {
	case "ed25519":
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("generate ed25519 key: %w", err)
		}
		sshPub, err = ssh.NewPublicKey(pub)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("encode public key: %w", err)
		}
		if input.Passphrase != "" {
			privBlock, err = ssh.MarshalPrivateKeyWithPassphrase(priv, input.Comment, []byte(input.Passphrase))
		} else {
			privBlock, err = ssh.MarshalPrivateKey(priv, input.Comment)
		}
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("marshal private key: %w", err)
		}
	case "rsa":
		bits := input.RSABits
		if bits == 0 {
			bits = f.d.Cfg.SSH.DefaultRSAKeyBits
		}
		priv, err := rsa.GenerateKey(rand.Reader, bits)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("generate rsa key: %w", err)
		}
		sshPub, err = ssh.NewPublicKey(&priv.PublicKey)
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("encode public key: %w", err)
		}
		if input.Passphrase != "" {
			privBlock, err = ssh.MarshalPrivateKeyWithPassphrase(priv, input.Comment, []byte(input.Passphrase))
		} else {
			privBlock, err = ssh.MarshalPrivateKey(priv, input.Comment)
		}
		if err != nil {
			return GenerateKeyResult{}, fmt.Errorf("marshal private key: %w", err)
		}
	default:
		return GenerateKeyResult{}, fmt.Errorf("unsupported key type: %s", input.KeyType)
	}

	// Write private key (mode 0600)
	privBytes := pem.EncodeToMemory(privBlock)
	if err := os.WriteFile(input.SavePath, privBytes, 0600); err != nil {
		return GenerateKeyResult{}, fmt.Errorf("write private key: %w", err)
	}

	// Build public key line (optionally with comment)
	pubLine := strings.TrimRight(string(ssh.MarshalAuthorizedKey(sshPub)), "\n")
	if input.Comment != "" {
		pubLine += " " + input.Comment
	}
	pubLine += "\n"

	// Write public key (mode 0644)
	pubPath := input.SavePath + ".pub"
	if err := os.WriteFile(pubPath, []byte(pubLine), 0644); err != nil { //nolint:gosec
		return GenerateKeyResult{}, fmt.Errorf("write public key: %w", err)
	}

	return GenerateKeyResult{
		PrivateKeyPath: input.SavePath,
		PublicKeyPath:  pubPath,
		PublicKeyText:  pubLine,
	}, nil
}

// BrowseKeyFile opens a native file picker defaulting to ~/.ssh/ and returns
// the selected file path, or an empty string if the user cancelled.
func (f *KeysFacade) BrowseKeyFile() (string, error) {
	home, _ := os.UserHomeDir()
	defaultDir := filepath.Join(home, ".ssh")
	path, err := wailsruntime.OpenFileDialog(f.d.Ctx, wailsruntime.OpenDialogOptions{
		DefaultDirectory: defaultDir,
		Title:            "Select SSH Private Key",
	})
	if err != nil {
		return "", err
	}
	return path, nil
}

// ReadPublicKeyText reads a public key file and returns its first line.
// If path does not end in ".pub", ".pub" is appended before reading.
func (f *KeysFacade) ReadPublicKeyText(path string) (string, error) {
	pubPath := path
	if !strings.HasSuffix(pubPath, ".pub") {
		pubPath = path + ".pub"
	}
	data, err := os.ReadFile(pubPath)
	if err != nil {
		return "", fmt.Errorf("read public key: %w", err)
	}
	line := strings.SplitN(strings.TrimRight(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n"), "\n", 2)[0]
	return line, nil
}

// DeployPublicKey installs a public key on the remote host's ~/.ssh/authorized_keys,
// equivalent to running ssh-copy-id. The operation is idempotent.
// publicKeyPath may be the private key path; ".pub" is appended if missing.
// Returns the SHA256 fingerprint of the deployed key on success.
func (f *KeysFacade) DeployPublicKey(hostID string, publicKeyPath string) (string, error) {
	// 1. Derive and read the public key file.
	pubPath := publicKeyPath
	if !strings.HasSuffix(pubPath, ".pub") {
		pubPath = publicKeyPath + ".pub"
	}
	pubKeyBytes, err := os.ReadFile(pubPath)
	if err != nil {
		return "", fmt.Errorf("read public key file: %w", err)
	}

	// 2. Parse for fingerprint and canonical form (type + base64, no comment).
	parsed, _, _, _, err := ssh.ParseAuthorizedKey(pubKeyBytes)
	if err != nil {
		return "", fmt.Errorf("parse public key: %w", err)
	}
	fingerprint := ssh.FingerprintSHA256(parsed)
	canonical := strings.TrimRight(string(ssh.MarshalAuthorizedKey(parsed)), "\n")

	// 3. Resolve credentials — error if no saved credential.
	host, secret, err := f.d.Store.GetHostForConnect(hostID)
	if err != nil {
		return "", fmt.Errorf("get credentials: %w", err)
	}

	// 4. Build known-hosts callback.
	hostKeyCallback, err := goph.DefaultKnownHosts()
	if err != nil {
		return "", fmt.Errorf("load known_hosts: %w", err)
	}

	const dialTimeout = 30 * time.Second

	// 5. Dial SSH (direct or via jump host).
	var client *goph.Client

	if host.JumpHostID != nil {
		jh, jp, err := f.d.Store.GetHostForConnect(*host.JumpHostID)
		if err != nil {
			return "", fmt.Errorf("get jump host credentials: %w", err)
		}
		jumpAuth, err := session.ResolveAuth(jh, jp)
		if err != nil {
			return "", fmt.Errorf("jump host auth: %w", err)
		}
		jumpSSHCfg := &ssh.ClientConfig{
			User:            jh.Username,
			Auth:            jumpAuth,
			HostKeyCallback: hostKeyCallback,
			Timeout:         dialTimeout,
		}
		jumpConn, err := net.DialTimeout("tcp",
			net.JoinHostPort(jh.Hostname, fmt.Sprintf("%d", jh.Port)), dialTimeout)
		if err != nil {
			return "", fmt.Errorf("dial jump host: %w", err)
		}
		ncc, chans, reqs, err := ssh.NewClientConn(jumpConn, jh.Hostname, jumpSSHCfg)
		if err != nil {
			jumpConn.Close()
			return "", fmt.Errorf("connect jump host: %w", err)
		}
		jumpClient := ssh.NewClient(ncc, chans, reqs)
		defer jumpClient.Close()

		targetAuth, err := session.ResolveAuth(host, secret)
		if err != nil {
			return "", fmt.Errorf("target host auth: %w", err)
		}
		targetSSHCfg := &ssh.ClientConfig{
			User:            host.Username,
			Auth:            targetAuth,
			HostKeyCallback: hostKeyCallback,
			Timeout:         dialTimeout,
		}
		tunnelConn, err := jumpClient.Dial("tcp",
			net.JoinHostPort(host.Hostname, fmt.Sprintf("%d", host.Port)))
		if err != nil {
			return "", fmt.Errorf("dial target through jump host: %w", err)
		}
		targetNCC, targetChans, targetReqs, err := ssh.NewClientConn(
			tunnelConn, host.Hostname, targetSSHCfg)
		if err != nil {
			tunnelConn.Close()
			return "", fmt.Errorf("connect target via jump host: %w", err)
		}
		client = &goph.Client{Client: ssh.NewClient(targetNCC, targetChans, targetReqs)}
	} else {
		auth, err := session.ResolveAuth(host, secret)
		if err != nil {
			return "", fmt.Errorf("host auth: %w", err)
		}
		client, err = goph.NewConn(&goph.Config{
			User:     host.Username,
			Addr:     host.Hostname,
			Port:     uint(host.Port),
			Auth:     auth,
			Timeout:  dialTimeout,
			Callback: hostKeyCallback,
		})
		if err != nil {
			return "", fmt.Errorf(
				"connect to host (host key unknown? connect via terminal first): %w", err)
		}
	}
	defer client.Close()

	// 6. Ensure ~/.ssh exists with correct permissions.
	if _, err := client.Run("mkdir -p ~/.ssh && chmod 700 ~/.ssh"); err != nil {
		return "", fmt.Errorf("create ~/.ssh on remote: %w", err)
	}

	// 7. Idempotent append via SFTP (avoids shell injection from key comment field).
	sftpClient, err := client.NewSftp()
	if err != nil {
		return "", fmt.Errorf("open sftp: %w", err)
	}
	defer sftpClient.Close()

	const akPath = ".ssh/authorized_keys"
	existing, err := func() ([]byte, error) {
		f, err := sftpClient.Open(akPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, nil
			}
			return nil, err
		}
		defer f.Close()
		return io.ReadAll(f)
	}()
	if err != nil {
		return "", fmt.Errorf("read authorized_keys: %w", err)
	}

	if !bytes.Contains(existing, []byte(canonical)) {
		newContent := append(existing, []byte(canonical+"\n")...)
		f, err := sftpClient.OpenFile(akPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
		if err != nil {
			return "", fmt.Errorf("open authorized_keys for writing: %w", err)
		}
		if _, writeErr := f.Write(newContent); writeErr != nil {
			f.Close()
			return "", fmt.Errorf("write authorized_keys: %w", writeErr)
		}
		f.Close()
	}

	// 8. Fix permissions on authorized_keys.
	if _, err := client.Run("chmod 600 ~/.ssh/authorized_keys"); err != nil {
		return "", fmt.Errorf("chmod authorized_keys: %w", err)
	}

	return fingerprint, nil
}
