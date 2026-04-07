package registry

// Bundle is the wire format for a host/group configuration bundle.
// It extends the existing shsh JSON export format with registry metadata.
type Bundle struct {
	Version  int        `json:"version"`
	Bundle   string     `json:"bundle"`            // "namespace/name"
	Tag      string     `json:"tag"`
	PushedAt string     `json:"pushedAt,omitempty"` // RFC3339, set by server
	Hosts    []HostItem `json:"hosts"`
}

// HostItem is a credential-free host entry within a bundle.
// Mirrors the existing export.jsonHostItem format.
type HostItem struct {
	Label      string   `json:"label"`
	Hostname   string   `json:"hostname"`
	Port       int      `json:"port"`
	Username   string   `json:"username"`
	AuthMethod string   `json:"authMethod"`
	KeyPath    string   `json:"keyPath,omitempty"`
	Tags       []string `json:"tags,omitempty"`
	Group      string   `json:"group,omitempty"`
	Color      string   `json:"color,omitempty"`
}

// PushRequest is the client payload when pushing a new bundle version.
type PushRequest struct {
	Tag   string     `json:"tag"`
	Hosts []HostItem `json:"hosts"`
}

// BundleInfo is returned when listing bundles in a namespace.
type BundleInfo struct {
	Name      string `json:"name"`
	CreatedAt string `json:"createdAt"`
}

// TagInfo is returned when listing tags for a bundle.
type TagInfo struct {
	Tag      string `json:"tag"`
	PushedAt string `json:"pushedAt"`
}

// ErrorResponse is the standard error envelope for the REST API.
type ErrorResponse struct {
	Error string `json:"error"`
}
