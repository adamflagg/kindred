// Package jotform reads form submissions from the Jotform REST API
// (kindred#2759). It knows nothing about PocketBase: the sync service in
// pocketbase/sync owns storage and matching.
//
// The base URL is configurable (JOTFORM_API_BASE) because the forms are moving
// to an enterprise account, whose API host differs from api.jotform.com. The
// key travels in the APIKEY header, never the query string.
package jotform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is the public Jotform API host.
const DefaultBaseURL = "https://api.jotform.com"

// MaxPageSize is the largest `limit` the submissions endpoint accepts.
const MaxPageSize = 1000

// maxResponseBytes caps one page's body so a runaway response cannot exhaust memory.
const maxResponseBytes = 64 << 20

// ErrNoAPIKey is returned when no key is configured. The job fails loudly
// rather than running and storing nothing.
var ErrNoAPIKey = errors.New("JOTFORM_API_KEY is not set")

// Config configures a Client. Zero values take the defaults.
type Config struct {
	APIKey     string
	BaseURL    string
	PageSize   int
	HTTPClient *http.Client
}

// Client is a Jotform REST client.
type Client struct {
	apiKey   string
	baseURL  string
	pageSize int
	http     *http.Client
}

// NewClient validates cfg and applies its defaults.
func NewClient(cfg Config) (*Client, error) {
	key := strings.TrimSpace(cfg.APIKey)
	if key == "" {
		return nil, ErrNoAPIKey
	}
	base := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	size := cfg.PageSize
	if size <= 0 || size > MaxPageSize {
		size = MaxPageSize
	}
	hc := cfg.HTTPClient
	if hc == nil {
		hc = &http.Client{Timeout: 60 * time.Second}
	}
	return &Client{apiKey: key, baseURL: base, pageSize: size, http: hc}, nil
}

// NewClientFromEnv builds a Client from JOTFORM_API_KEY and JOTFORM_API_BASE.
func NewClientFromEnv() (*Client, error) {
	return NewClient(Config{
		APIKey:  os.Getenv("JOTFORM_API_KEY"),
		BaseURL: os.Getenv("JOTFORM_API_BASE"),
	})
}

// Answer is one question's entry in a submission's `answers` object. Answer
// holds the raw JSON: a string for most controls, an object for a full name or
// an address, an array for a checkbox. Entries with no `answer` key are page
// headers and dividers.
type Answer struct {
	Name         string          `json:"name"`
	Order        string          `json:"order"`
	Text         string          `json:"text"`
	Type         string          `json:"type"`
	Answer       json.RawMessage `json:"answer"`
	PrettyFormat string          `json:"prettyFormat"`
}

// Submission is one form submission as the API reports it.
type Submission struct {
	ID        string
	FormID    string
	CreatedAt string
	UpdatedAt string
	Status    string
	Answers   map[string]Answer
}

type wireSubmission struct {
	ID        string          `json:"id"`
	FormID    string          `json:"form_id"`
	CreatedAt string          `json:"created_at"`
	UpdatedAt *string         `json:"updated_at"`
	Status    string          `json:"status"`
	Answers   json.RawMessage `json:"answers"`
}

// UnmarshalJSON accepts `"answers": []` (Jotform's spelling of none) and a
// null `updated_at`.
func (s *Submission) UnmarshalJSON(data []byte) error {
	var w wireSubmission
	if err := json.Unmarshal(data, &w); err != nil {
		return fmt.Errorf("decoding jotform submission: %w", err)
	}
	s.ID, s.FormID, s.CreatedAt, s.Status = w.ID, w.FormID, w.CreatedAt, w.Status
	if w.UpdatedAt != nil {
		s.UpdatedAt = *w.UpdatedAt
	}
	s.Answers = map[string]Answer{}
	raw := bytes.TrimSpace(w.Answers)
	if len(raw) == 0 || raw[0] != '{' {
		return nil
	}
	if err := json.Unmarshal(raw, &s.Answers); err != nil {
		return fmt.Errorf("decoding answers of jotform submission %s: %w", s.ID, err)
	}
	return nil
}

type envelope struct {
	ResponseCode int             `json:"responseCode"`
	Message      string          `json:"message"`
	Content      json.RawMessage `json:"content"`
}

// FormSubmissions returns every submission of a form, paging until a short
// page. Any failed page fails the WHOLE call with no partial result, so the
// caller can never mistake a truncated pull for deletions.
func (c *Client) FormSubmissions(ctx context.Context, formID string) ([]Submission, error) {
	var all []Submission
	for offset := 0; ; offset += c.pageSize {
		page, err := c.submissionsPage(ctx, formID, offset)
		if err != nil {
			return nil, err
		}
		all = append(all, page...)
		if len(page) < c.pageSize {
			return all, nil
		}
	}
}

func (c *Client) submissionsPage(ctx context.Context, formID string, offset int) ([]Submission, error) {
	query := url.Values{}
	query.Set("limit", strconv.Itoa(c.pageSize))
	query.Set("offset", strconv.Itoa(offset))
	endpoint := fmt.Sprintf("%s/form/%s/submissions?%s",
		c.baseURL, url.PathEscape(formID), query.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("building Jotform request: %w", err)
	}
	req.Header.Set("APIKEY", c.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("jotform form %s offset %d: %w", formID, offset, err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("reading jotform form %s offset %d: %w", formID, offset, err)
	}

	var env envelope
	decodeErr := json.Unmarshal(body, &env)
	if resp.StatusCode != http.StatusOK || decodeErr != nil || env.ResponseCode != http.StatusOK {
		return nil, fmt.Errorf("jotform form %s offset %d: HTTP %d, responseCode %d: %s",
			formID, offset, resp.StatusCode, env.ResponseCode, env.Message)
	}
	var subs []Submission
	if err := json.Unmarshal(env.Content, &subs); err != nil {
		return nil, fmt.Errorf("decoding jotform form %s offset %d: %w", formID, offset, err)
	}
	return subs, nil
}
