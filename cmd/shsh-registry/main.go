package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/dylanbr0wn/shsh/internal/registry"
)

const usage = `shsh-registry — host configuration registry server

Usage:
  shsh-registry serve    [--port PORT] [--db PATH]
  shsh-registry ns create NAME
  shsh-registry ns list
  shsh-registry ns rotate-key NAME

Options:
  --port PORT    Port to listen on (default: 8080)
  --db PATH      SQLite database path (default: registry.db)
`

func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(1)
	}

	dbPath := envOr("SHSH_REGISTRY_DB", "registry.db")
	port := envOr("SHSH_REGISTRY_PORT", "8080")

	// Parse global flags from remaining args.
	for i := 2; i < len(os.Args); i++ {
		switch os.Args[i] {
		case "--db":
			if i+1 < len(os.Args) {
				dbPath = os.Args[i+1]
				i++
			}
		case "--port":
			if i+1 < len(os.Args) {
				port = os.Args[i+1]
				i++
			}
		}
	}

	switch os.Args[1] {
	case "serve":
		cmdServe(dbPath, port)
	case "ns":
		if len(os.Args) < 3 {
			fmt.Println("Usage: shsh-registry ns <create|list|rotate-key> [args]")
			os.Exit(1)
		}
		cmdNs(dbPath, os.Args[2], os.Args[3:])
	default:
		fmt.Print(usage)
		os.Exit(1)
	}
}

func cmdServe(dbPath, port string) {
	store, err := registry.NewStore(dbPath)
	if err != nil {
		fatal("open store: %v", err)
	}
	defer store.Close()

	addr := ":" + port
	srv := registry.NewServer(addr, store)

	// Graceful shutdown on SIGINT/SIGTERM.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		fmt.Printf("shsh-registry listening on %s (db: %s)\n", addr, dbPath)
		if err := srv.ListenAndServe(); err != nil && err.Error() != "http: Server closed" {
			fatal("serve: %v", err)
		}
	}()

	<-ctx.Done()
	fmt.Println("\nshutting down...")
	srv.Shutdown(context.Background())
}

func cmdNs(dbPath, subcmd string, args []string) {
	store, err := registry.NewStore(dbPath)
	if err != nil {
		fatal("open store: %v", err)
	}
	defer store.Close()

	switch subcmd {
	case "create":
		if len(args) == 0 || args[0] == "" || args[0][0] == '-' {
			fatal("usage: shsh-registry ns create NAME")
		}
		name := args[0]
		key := generateAPIKey()
		if err := store.CreateNamespace(name, key); err != nil {
			fatal("create namespace: %v", err)
		}
		fmt.Printf("Namespace: %s\nAPI Key:   %s\n", name, key)
		fmt.Println("\nSave this key — it cannot be retrieved later.")

	case "list":
		names, err := store.ListNamespaces()
		if err != nil {
			fatal("list namespaces: %v", err)
		}
		if len(names) == 0 {
			fmt.Println("No namespaces found.")
			return
		}
		for _, n := range names {
			fmt.Println(n)
		}

	case "rotate-key":
		if len(args) == 0 || args[0] == "" || args[0][0] == '-' {
			fatal("usage: shsh-registry ns rotate-key NAME")
		}
		name := args[0]
		key := generateAPIKey()
		if err := store.RotateKey(name, key); err != nil {
			fatal("rotate key: %v", err)
		}
		fmt.Printf("New API Key for %s: %s\n", name, key)
		fmt.Println("\nSave this key — it cannot be retrieved later. The old key is now invalid.")

	default:
		fatal("unknown ns subcommand: %s", subcmd)
	}
}

func generateAPIKey() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		fatal("generate key: %v", err)
	}
	return "shsh_" + hex.EncodeToString(b)
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func fatal(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "error: "+format+"\n", args...)
	os.Exit(1)
}
