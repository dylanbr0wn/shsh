# Contributing

idk just do it

## things to work on

  ---
  High-Impact / Table-Stakes

  Port Forwarding
  - Local port forwarding (e.g., tunnel a remote DB to localhost)
  - Remote port forwarding
  - Dynamic SOCKS5 proxy
  - Manage/view active tunnels per session

  Jump Hosts / Bastion
  - ProxyJump support (connect through an intermediate host)
  - Chain multiple hops
  - Reference saved hosts as jump hosts

  Session Logging
  - Write terminal output to a file (timestamped)
  - Toggle logging on/off per session
  - Log viewer

  Snippets / Quick Commands
  - Save frequently used commands
  - Insert with a keystroke or click
  - Organize into folders
  - Per-host or global snippets

  ---
  Organization & Workflow

  Host Groups / Folders
  - Nest hosts into collapsible groups (dev, staging, prod)
  - Bulk connect all hosts in a group

  Tags & Color Coding
  - Tag hosts with labels (e.g., "production", "personal")
  - Color-code the terminal tab or sidebar entry per host

  Notes per Host
  - Free-text notes attached to a saved host
  - Shown in sidebar or connection modal

  Quick Connect
  - Connect without saving (ad-hoc user@host:port)

  ---
  Credentials & Keys

  SSH Key Generation
  - Generate ed25519/RSA keys from within the app
  - Save to ~/.ssh/ or a custom path

  Key Management UI
  - List, inspect, and delete SSH keys
  - Associate a key with a saved host

  macOS Keychain / OS Credential Store
  - Store passwords in the native keychain instead of plaintext DB

  ---
  Terminal UX

  Split Panes
  - Horizontal/vertical terminal splits within a session
  - Independent scrollback per pane

  Broadcast Input
  - Type the same command into multiple sessions simultaneously
  - Toggle per-session

  Auto-Reconnect
  - Detect dropped connections and attempt to reconnect automatically
  - Configurable retry delay/limit

  Terminal Profiles
  - Different font/color/behavior configs per host or group

  ---
  SFTP Enhancements

  Drag & Drop File Upload
  - Drop files from Finder/Explorer directly into the SFTP panel

  Dual-Pane File Manager
  - Local filesystem on the left, remote on the right (like FileZilla)

  Transfer Queue / History
  - View queued and completed transfers
  - Retry failed transfers

  File Preview
  - Preview text/image files without downloading

  ---
  Misc / Polish

  Export/Import Hosts
  - Export host list to JSON/CSV for backup or sharing
  - Import from other clients (Termius export, .ssh/config)

  Connection Status Dashboard
  - Overview panel showing all host statuses (online/offline ping)

  Host Health / Ping
  - Periodic ping to show latency or reachability in the sidebar

  Environment Variables per Host
  - Set ENV=value pairs that get sent on connect
