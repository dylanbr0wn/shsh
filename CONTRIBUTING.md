# Contributing

idk just do it

## things to work on

  ---
  High-Impact / Table-Stakes

  ~~Jump Hosts / Bastion~~ *(done — #3)*
  - ~~ProxyJump support (connect through an intermediate host)~~
  - ~~Chain multiple hops~~
  - ~~Reference saved hosts as jump hosts~~

  Snippets / Quick Commands
  - Save frequently used commands
  - Insert with a keystroke or click
  - Organize into folders
  - Per-host or global snippets

  ---
  Organization & Workflow

  Notes per Host
  - Free-text notes attached to a saved host
  - Shown in sidebar or connection modal

  ~~Host Search / Filter~~ *(done — #11)*
  - ~~Search input in sidebar that filters hosts by name, hostname, username, or group in real time~~
  - ~~Critical as host list grows~~

  Favorites / Starred Hosts
  - Star icon per host; starred hosts float to top of sidebar or get a dedicated "Favorites" section
  - Persist as a bool on the host record

  Connection Recents
  - last_connected_at already exists on Host; expose a "Recent" sidebar section or Cmd+K-style quick picker
  - Quick access to the last N connected hosts

  ~~Tags for Hosts~~ *(done — #11)*
  - ~~Color-coded tags as an alternative/supplement to groups (used in Termius, MobaXterm)~~
  - ~~Filter sidebar by tag; many-to-many relationship (host can have multiple tags)~~

  ---
  Credentials & Keys

  Touch ID / Biometric Unlock
  - Require macOS Touch ID before revealing saved passwords
  - Uses LocalAuthentication framework; macOS-only build tag

  Master Password / Vault Lock
  - Optional master password that encrypts the credential store
  - Lock the app and require master password on resume

  ---
  Terminal UX

  ~~Terminal Scrollback Search~~ *(done)*
  - ~~Ctrl+F search within the terminal buffer~~
  - ~~xterm.js ships SearchAddon for this; every major SSH client has it~~

  ~~Split Panes~~ *(done — #14)*
  - ~~Horizontal/vertical terminal splits within a session~~
  - ~~Independent scrollback per pane~~

  Broadcast Input
  - Type the same command into multiple sessions simultaneously
  - Toggle per-session

  Auto-Reconnect
  - Detect dropped connections and attempt to reconnect automatically
  - Configurable retry delay/limit

  ---
  SFTP Enhancements

  Dual-Pane File Manager
  - Local filesystem on the left, remote on the right (like FileZilla)

  Cross-Host File Transfer (SCP)
  - Remote-to-remote file transfer without streaming through the app process
  - Direct SCP/SFTP relay between two hosts when both support it

  ~~Drag-and-Drop File Transfers~~ *(done)*
  - ~~Drop local files onto the SFTP panel to upload~~
  - ~~Drag remote files to a local destination to download~~
  - ~~Wails supports native drag-drop events~~

  Remote File Quick-Edit
  - Right-click a remote file → open in local $EDITOR
  - Watch for changes and auto-upload on save (like MobaXterm)

  Transfer Queue / History
  - View queued and completed transfers
  - Retry failed transfers

  Tabbed SFTP
  - Multiple directory tabs within a single SFTP pane
  - Navigate different directories without losing your place

  File Preview
  - Preview text/image files without downloading

  ---
  Misc / Polish

  Export/Import Hosts
  - Export host list to JSON/CSV for backup or sharing
  - Import from other clients (Termius export, .ssh/config)

  Connection Status Dashboard
  - Overview panel showing all host statuses (online/offline ping)

  Environment Variables per Host
  - Set ENV=value pairs that get sent on connect

  Keybinding Customization
  - Remappable keyboard shortcuts (new tab, snippets picker, split pane, etc.)
  - Saved to app config JSON

  Pane Drag-and-Drop Reordering
  - Drag panes within the split tree to rearrange layout
  - Drag a pane from one workspace into another

  X11 Forwarding
  - Forward X11 display so remote GUI apps render locally
  - Requires XQuartz on macOS (user's responsibility)
