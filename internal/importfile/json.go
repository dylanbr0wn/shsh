package importfile

import "encoding/json"

type jsonEnvelope struct {
	Version    int            `json:"version"`
	ExportedAt string         `json:"exportedAt"`
	Hosts      []jsonHostItem `json:"hosts"`
}

type jsonHostItem struct {
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

// ParseJSON parses shsh JSON export content into import candidates.
func ParseJSON(content []byte) ([]ImportCandidate, error) {
	var env jsonEnvelope
	if err := json.Unmarshal(content, &env); err != nil {
		return nil, err
	}

	candidates := make([]ImportCandidate, 0, len(env.Hosts))
	for _, h := range env.Hosts {
		auth := h.AuthMethod
		if auth == "" {
			auth = "agent"
		}
		candidates = append(candidates, ImportCandidate{
			Label:      h.Label,
			Hostname:   h.Hostname,
			Port:       h.Port,
			Username:   h.Username,
			AuthMethod: auth,
			KeyPath:    h.KeyPath,
			Tags:       h.Tags,
			GroupName:  h.Group,
			Color:      h.Color,
		})
	}
	return candidates, nil
}
