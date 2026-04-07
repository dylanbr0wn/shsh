package regclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/dylanbr0wn/shsh/internal/registry"
)

// Client is an HTTP client for a shsh registry server.
type Client struct {
	baseURL    string
	apiKey     string
	httpClient *http.Client
}

// New creates a new registry client targeting the given server URL with the given API key.
func New(baseURL, apiKey string) *Client {
	return &Client{
		baseURL: baseURL,
		apiKey:  apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// ListBundles returns all bundles in the given namespace.
func (c *Client) ListBundles(namespace string) ([]registry.BundleInfo, error) {
	path := fmt.Sprintf("/v1/namespaces/%s/bundles", namespace)
	var out []registry.BundleInfo
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ListTags returns all tags for a bundle.
func (c *Client) ListTags(namespace, name string) ([]registry.TagInfo, error) {
	path := fmt.Sprintf("/v1/namespaces/%s/bundles/%s/tags", namespace, name)
	var out []registry.TagInfo
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Pull downloads a bundle version. If tag is empty, returns the latest.
func (c *Client) Pull(namespace, name, tag string) (*registry.Bundle, error) {
	path := fmt.Sprintf("/v1/namespaces/%s/bundles/%s", namespace, name)
	if tag != "" {
		path += "?tag=" + url.QueryEscape(tag)
	}
	var out registry.Bundle
	if err := c.get(path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// Push uploads a new bundle version.
func (c *Client) Push(namespace, name string, req registry.PushRequest) error {
	path := fmt.Sprintf("/v1/namespaces/%s/bundles/%s", namespace, name)
	return c.put(path, req)
}

// DeleteVersion removes a specific tag from a bundle.
func (c *Client) DeleteVersion(namespace, name, tag string) error {
	path := fmt.Sprintf("/v1/namespaces/%s/bundles/%s?tag=%s", namespace, name, url.QueryEscape(tag))
	return c.delete(path)
}

func (c *Client) get(path string, out any) error {
	req, err := http.NewRequest("GET", c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("registry request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return c.readError(resp)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func (c *Client) put(path string, body any) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequest("PUT", c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("registry request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		return c.readError(resp)
	}
	return nil
}

func (c *Client) delete(path string) error {
	req, err := http.NewRequest("DELETE", c.baseURL+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("registry request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusNoContent {
		return c.readError(resp)
	}
	return nil
}

func (c *Client) readError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	var errResp registry.ErrorResponse
	if json.Unmarshal(body, &errResp) == nil && errResp.Error != "" {
		return fmt.Errorf("registry: %s (HTTP %d)", errResp.Error, resp.StatusCode)
	}
	return fmt.Errorf("registry: HTTP %d: %s", resp.StatusCode, string(body))
}
