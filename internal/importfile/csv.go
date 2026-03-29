package importfile

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
)

// ParseCSV parses CSV content into import candidates.
// format must be FormatShshCSV or FormatTermiusCSV (determines column mapping).
// Returns the parsed candidates and the number of skipped rows (e.g. non-SSH in Termius).
func ParseCSV(content []byte, format Format) ([]ImportCandidate, int, error) {
	r := csv.NewReader(strings.NewReader(string(content)))
	records, err := r.ReadAll()
	if err != nil {
		return nil, 0, fmt.Errorf("parse CSV: %w", err)
	}
	if len(records) < 2 {
		return []ImportCandidate{}, 0, nil
	}

	switch format {
	case FormatShshCSV:
		return parseShshCSV(records[1:])
	case FormatTermiusCSV:
		return parseTermiusCSV(records[1:])
	default:
		return nil, 0, fmt.Errorf("unsupported CSV format: %s", format)
	}
}

func parseShshCSV(rows [][]string) ([]ImportCandidate, int, error) {
	candidates := make([]ImportCandidate, 0, len(rows))
	for i, row := range rows {
		if len(row) < 9 {
			return nil, 0, fmt.Errorf("row %d: expected 9 columns, got %d", i+2, len(row))
		}
		port, err := strconv.Atoi(row[2])
		if err != nil {
			return nil, 0, fmt.Errorf("row %d: invalid port %q", i+2, row[2])
		}

		var tags []string
		if row[6] != "" {
			tags = strings.Split(row[6], "|")
		}

		auth := row[4]
		if auth == "" {
			auth = "agent"
		}

		candidates = append(candidates, ImportCandidate{
			Label:      row[0],
			Hostname:   row[1],
			Port:       port,
			Username:   row[3],
			AuthMethod: auth,
			KeyPath:    row[5],
			Tags:       tags,
			GroupName:  row[7],
			Color:      row[8],
		})
	}
	return candidates, 0, nil
}

func parseTermiusCSV(rows [][]string) ([]ImportCandidate, int, error) {
	candidates := make([]ImportCandidate, 0, len(rows))
	skipped := 0

	for i, row := range rows {
		if len(row) < 9 {
			return nil, 0, fmt.Errorf("row %d: expected 9 columns, got %d", i+2, len(row))
		}

		protocol := strings.ToLower(strings.TrimSpace(row[4]))
		if protocol != "ssh" && protocol != "" {
			skipped++
			continue
		}

		port, err := strconv.Atoi(row[5])
		if err != nil {
			port = 22
		}

		password := strings.TrimSpace(row[7])
		sshKey := strings.TrimSpace(row[8])

		var authMethod string
		switch {
		case password != "":
			authMethod = "password"
		case sshKey != "":
			authMethod = "key"
		default:
			authMethod = "agent"
		}

		var tags []string
		if t := strings.TrimSpace(row[2]); t != "" {
			for _, tag := range strings.Split(t, ",") {
				tag = strings.TrimSpace(tag)
				if tag != "" {
					tags = append(tags, tag)
				}
			}
		}

		candidates = append(candidates, ImportCandidate{
			Label:      strings.TrimSpace(row[1]),
			Hostname:   strings.TrimSpace(row[3]),
			Port:       port,
			Username:   strings.TrimSpace(row[6]),
			AuthMethod: authMethod,
			KeyPath:    sshKey,
			Password:   password,
			Tags:       tags,
			GroupName:  strings.TrimSpace(row[0]),
		})
	}
	return candidates, skipped, nil
}
