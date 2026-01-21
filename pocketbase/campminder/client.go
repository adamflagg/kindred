// Package campminder provides a client for interacting with the CampMinder API
package campminder

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	baseURL = "https://api.campminder.com"
)

// Client wraps CampMinder API interactions
type Client struct {
	apiKey          string
	subscriptionKey string
	clientID        string
	seasonID        int
	httpClient      *http.Client
	accessToken     string
	tokenExpiry     time.Time
}

// Config holds CampMinder configuration
type Config struct {
	APIKey   string
	ClientID string
	SeasonID int
}

// NewClient creates a new CampMinder client
func NewClient(cfg *Config) (*Client, error) {
	if cfg.APIKey == "" || cfg.ClientID == "" || cfg.SeasonID == 0 {
		return nil, fmt.Errorf("missing required CampMinder configuration")
	}

	// Get subscription key from environment
	subscriptionKey := os.Getenv("CAMPMINDER_PRIMARY_KEY")
	if subscriptionKey == "" {
		return nil, fmt.Errorf("CAMPMINDER_PRIMARY_KEY not set in environment")
	}

	client := &Client{
		apiKey:          cfg.APIKey,
		subscriptionKey: subscriptionKey,
		clientID:        cfg.ClientID,
		seasonID:        cfg.SeasonID,
		httpClient:      &http.Client{Timeout: 30 * time.Second},
	}

	return client, nil
}

// authenticate gets a new JWT token from CampMinder
func (c *Client) authenticate() error {
	authURL := fmt.Sprintf("%s/auth/apikey", baseURL)
	fmt.Printf("CampMinder: Authenticating with clientID: %s\n", c.clientID)

	req, err := http.NewRequest("GET", authURL, nil)
	if err != nil {
		return fmt.Errorf("create auth request: %w", err)
	}

	// Get primary key from environment
	primaryKey := os.Getenv("CAMPMINDER_PRIMARY_KEY")
	if primaryKey == "" {
		return fmt.Errorf("CAMPMINDER_PRIMARY_KEY not set in environment")
	}

	// Set headers as per Python implementation
	req.Header.Set("Authorization", c.apiKey) // API key without Bearer prefix
	req.Header.Set("Ocp-Apim-Subscription-Key", primaryKey)
	req.Header.Set("X-Request-ID", fmt.Sprintf("AUTH-%d", time.Now().Unix()))

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("auth request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)

		// Handle rate limiting
		if resp.StatusCode == http.StatusTooManyRequests {
			waitTime := c.parseRateLimitSeconds(string(body))
			if waitTime > 0 {
				log.Printf("CampMinder: Rate limited during auth. Waiting %d seconds...", waitTime)
				time.Sleep(time.Duration(waitTime) * time.Second)
				// Retry authentication
				return c.authenticate()
			}
		}

		return fmt.Errorf("auth failed with status %d: %s", resp.StatusCode, string(body))
	}

	fmt.Println("CampMinder: Authentication successful")

	var authResp struct {
		Token string `json:"Token"` // Capital T as per Python response
	}

	if err := json.NewDecoder(resp.Body).Decode(&authResp); err != nil {
		return fmt.Errorf("decode auth response: %w", err)
	}

	c.accessToken = authResp.Token

	// Parse token expiry from JWT if possible, otherwise default to 1 hour
	// Try to decode JWT to get expiry
	parts := strings.Split(authResp.Token, ".")
	if len(parts) == 3 {
		// Decode payload (base64)
		payload := parts[1]
		// Add padding if needed
		if m := len(payload) % 4; m != 0 {
			payload += strings.Repeat("=", 4-m)
		}

		if decoded, err := base64.StdEncoding.DecodeString(payload); err == nil {
			var claims map[string]interface{}
			if err := json.Unmarshal(decoded, &claims); err == nil {
				if exp, ok := claims["exp"].(float64); ok {
					c.tokenExpiry = time.Unix(int64(exp), 0)
				} else {
					c.tokenExpiry = time.Now().Add(time.Hour)
				}
			} else {
				c.tokenExpiry = time.Now().Add(time.Hour)
			}
		} else {
			c.tokenExpiry = time.Now().Add(time.Hour)
		}
	} else {
		c.tokenExpiry = time.Now().Add(time.Hour)
	}

	return nil
}

// ensureAuthenticated ensures we have a valid token
func (c *Client) ensureAuthenticated() error {
	// Check if token is still valid
	if c.accessToken != "" && time.Now().Before(c.tokenExpiry.Add(-5*time.Minute)) {
		return nil
	}

	// Need to authenticate
	return c.authenticate()
}

// makeRequestWithURL makes an authenticated API request with a pre-built URL
func (c *Client) makeRequestWithURL(method, fullURL string) ([]byte, error) {
	return c.makeRequestWithURLRetry(method, fullURL, 0)
}

// makeRequestWithURLRetry makes an authenticated API request with retry logic
func (c *Client) makeRequestWithURLRetry(method, fullURL string, retryCount int) ([]byte, error) {
	if err := c.ensureAuthenticated(); err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	req, err := http.NewRequest(method, fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Get primary key from environment
	primaryKey := os.Getenv("CAMPMINDER_PRIMARY_KEY")
	if primaryKey == "" {
		return nil, fmt.Errorf("CAMPMINDER_PRIMARY_KEY not set in environment")
	}

	// Set headers
	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Ocp-Apim-Subscription-Key", primaryKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	// Handle rate limiting
	if resp.StatusCode == http.StatusTooManyRequests && retryCount < 10 {
		waitTime := c.parseRateLimitSeconds(string(body))
		if waitTime > 0 {
			log.Printf("CampMinder: Rate limited. Waiting %d seconds before retry %d/10...", waitTime, retryCount+1)
			time.Sleep(time.Duration(waitTime) * time.Second)
			// Retry the request
			return c.makeRequestWithURLRetry(method, fullURL, retryCount+1)
		}
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// makeRequest makes an authenticated API request
func (c *Client) makeRequest(method, endpoint string, params map[string]string) ([]byte, error) {
	if err := c.ensureAuthenticated(); err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	// Build URL with parameters
	fullURL := fmt.Sprintf("%s/%s", baseURL, strings.TrimPrefix(endpoint, "/"))

	if len(params) > 0 && method == "GET" {
		values := url.Values{}
		for k, v := range params {
			values.Add(k, v)
		}
		fullURL = fmt.Sprintf("%s?%s", fullURL, values.Encode())
	}

	var req *http.Request
	var err error

	if method == "GET" {
		req, err = http.NewRequest(method, fullURL, nil)
	} else {
		// For POST/PUT, send params as JSON body
		jsonBody, _ := json.Marshal(params)
		req, err = http.NewRequest(method, fullURL, bytes.NewBuffer(jsonBody))
		req.Header.Set("Content-Type", "application/json")
	}

	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Ocp-Apim-Subscription-Key", c.subscriptionKey)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	// Check for rate limiting
	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("rate limit exceeded (429)")
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error %d: %s", resp.StatusCode, string(body))
	}

	return body, nil
}

// GetSessions retrieves all sessions for the configured season
func (c *Client) GetSessions() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"seasonid":   strconv.Itoa(c.seasonID),
		"pagenumber": "1",
		"pagesize":   "100",
	}

	body, err := c.makeRequest("GET", "sessions", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode sessions response: %w", err)
	}

	return response.Results, nil
}

// GetAttendeesPage retrieves attendees with pagination
func (c *Client) GetAttendeesPage(page, pageSize int) ([]map[string]interface{}, bool, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"seasonid":   strconv.Itoa(c.seasonID),
		"pagenumber": strconv.Itoa(page),
		"pagesize":   strconv.Itoa(pageSize),
	}

	body, err := c.makeRequest("GET", "sessions/attendees", params)
	if err != nil {
		return nil, false, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Next       *string                  `json:"Next"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode attendees response: %w", err)
	}

	hasMore := response.Next != nil && *response.Next != ""
	return response.Results, hasMore, nil
}

// GetPersons retrieves person records by IDs
func (c *Client) GetPersons(personIDs []int) ([]map[string]interface{}, error) {
	if len(personIDs) == 0 {
		return nil, nil
	}

	// Build URL with multiple ID parameters matching Python implementation
	personsURL := fmt.Sprintf("%s/persons", baseURL)

	// Start with standard parameters
	values := url.Values{}
	values.Add("clientid", c.clientID)
	values.Add("seasonid", strconv.Itoa(c.seasonID))
	values.Add("includecamperdetails", "true")
	values.Add("includecontactdetails", "true")
	values.Add("includerelatives", "true")
	values.Add("includefamilypersons", "true")
	values.Add("includehouseholddetails", "true")
	values.Add("pagenumber", "1")
	values.Add("pagesize", strconv.Itoa(len(personIDs)))

	// Add multiple ID parameters, filtering out invalid IDs
	validIDCount := 0
	for _, id := range personIDs {
		if id > 0 { // Only include valid positive IDs
			values.Add("id", strconv.Itoa(id))
			validIDCount++
		}
	}

	// If no valid IDs after filtering, return early
	if validIDCount == 0 {
		return nil, nil
	}

	// Update pagesize to reflect actual count after filtering
	values.Set("pagesize", strconv.Itoa(validIDCount))

	fullURL := fmt.Sprintf("%s?%s", personsURL, values.Encode())

	// Use makeRequestWithURL since we built a custom URL
	body, err := c.makeRequestWithURL("GET", fullURL)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode persons response: %w", err)
	}

	return response.Results, nil
}

// GetPersonsPage retrieves all persons with pagination (no seasonid for latest data)
func (c *Client) GetPersonsPage(page, pageSize int) ([]map[string]interface{}, bool, error) {
	params := map[string]string{
		"clientid":                c.clientID,
		"pagenumber":              strconv.Itoa(page),
		"pagesize":                strconv.Itoa(pageSize),
		"includecamperdetails":    "true",
		"includecontactdetails":   "true",
		"includerelatives":        "true",
		"includefamilypersons":    "true",
		"includehouseholddetails": "true",
		// No seasonid - gets latest data
	}

	body, err := c.makeRequest("GET", "persons", params)
	if err != nil {
		return nil, false, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Next       *string                  `json:"Next"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode persons response: %w", err)
	}

	hasMore := response.Next != nil && *response.Next != ""
	return response.Results, hasMore, nil
}

// GetSeasonID returns the configured season ID
func (c *Client) GetSeasonID() int {
	return c.seasonID
}

// GetClientID returns the configured client ID
func (c *Client) GetClientID() string {
	return c.clientID
}

// GetBunks retrieves all bunks for the configured season
func (c *Client) GetBunks() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":       c.clientID,
		"seasonid":       strconv.Itoa(c.seasonID),
		"pagenumber":     "1",
		"pagesize":       "500",
		"orderby":        "Name",
		"orderascending": "true",
	}

	body, err := c.makeRequest("GET", "bunks", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		Results []map[string]interface{} `json:"Results"`
		Count   int                      `json:"count"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode bunks response: %w", err)
	}

	return response.Results, nil
}

// GetBunkPlansPage retrieves a page of bunk plans
func (c *Client) GetBunkPlansPage(page, pageSize int) ([]map[string]interface{}, bool, error) {
	params := map[string]string{
		"clientid":       c.clientID,
		"seasonid":       strconv.Itoa(c.seasonID),
		"pagenumber":     strconv.Itoa(page),
		"pagesize":       strconv.Itoa(pageSize),
		"orderascending": "true",
	}

	body, err := c.makeRequest("GET", "bunks/plans", params)
	if err != nil {
		return nil, false, err
	}

	var response struct {
		Results []map[string]interface{} `json:"Results"`
		Count   int                      `json:"count"`
		Next    *string                  `json:"next"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode bunk plans response: %w", err)
	}

	hasMore := response.Next != nil && *response.Next != ""
	return response.Results, hasMore, nil
}

// GetBunkAssignments retrieves bunk assignments for specified bunk plans and bunks
func (c *Client) GetBunkAssignments(bunkPlanIDs, bunkIDs []int, page, pageSize int) ([]map[string]interface{}, error) {
	// Build URL with multiple ID parameters
	assignURL := fmt.Sprintf("%s/bunks/assignments", baseURL)

	// Start with standard parameters
	values := url.Values{}
	values.Add("clientid", c.clientID)
	values.Add("seasonid", strconv.Itoa(c.seasonID))
	values.Add("pagenumber", strconv.Itoa(page))
	values.Add("pagesize", strconv.Itoa(pageSize))

	// Add multiple bunk plan IDs
	for _, id := range bunkPlanIDs {
		values.Add("bunkplanids", strconv.Itoa(id))
	}

	// Add multiple bunk IDs
	for _, id := range bunkIDs {
		values.Add("bunkids", strconv.Itoa(id))
	}

	fullURL := fmt.Sprintf("%s?%s", assignURL, values.Encode())

	// Use makeRequestWithURL which now has rate limit handling
	body, err := c.makeRequestWithURL("GET", fullURL)
	if err != nil {
		return nil, err
	}

	var response struct {
		Results []map[string]interface{} `json:"Results"`
		Count   int                      `json:"count"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode assignments response: %w", err)
	}

	return response.Results, nil
}

// CloneWithYear creates a new client instance with a different year
// This is useful for historical syncs without affecting the original client
func (c *Client) CloneWithYear(year int) *Client {
	newClient := &Client{
		apiKey:          c.apiKey,
		subscriptionKey: c.subscriptionKey,
		clientID:        c.clientID,
		seasonID:        year, // Use the provided year
		httpClient:      c.httpClient,
		accessToken:     c.accessToken,
		tokenExpiry:     c.tokenExpiry,
	}
	return newClient
}

// parseRateLimitSeconds extracts the wait time from a rate limit error message
// Example: "Rate limit is exceeded. Try again in 60 seconds."
func (c *Client) parseRateLimitSeconds(body string) int {
	// First try the JSON format response
	var jsonResp struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(body), &jsonResp); err == nil && jsonResp.Message != "" {
		body = jsonResp.Message
	}

	// Try to extract number from "Try again in X seconds"
	var seconds int
	pattern := "Rate limit is exceeded. Try again in %d seconds."
	if _, err := fmt.Sscanf(body, pattern, &seconds); err == nil && seconds > 0 {
		// Add 5 second buffer to ensure we're past the limit
		return seconds + 5
	}

	// Default to 60 seconds if we can't parse
	return 60
}

// GetSessionGroups retrieves session groupings for the configured season
func (c *Client) GetSessionGroups() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"seasonid":   strconv.Itoa(c.seasonID),
		"pagenumber": "1",
		"pagesize":   "100",
	}

	body, err := c.makeRequest("GET", "sessions/groups", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode session groups response: %w", err)
	}

	return response.Results, nil
}

// GetPersonTagDefinitions retrieves person tag definitions from CampMinder
// Endpoint: /persons/tags
// Returns: array of tag definitions with Name, IsSeasonal, IsHidden, LastUpdatedUTC
func (c *Client) GetPersonTagDefinitions() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid": c.clientID,
	}

	body, err := c.makeRequest("GET", "persons/tags", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode person tag definitions response: %w", err)
	}

	return response.Results, nil
}
