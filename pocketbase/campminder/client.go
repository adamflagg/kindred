// Package campminder provides a client for interacting with the CampMinder API
package campminder

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"log/slog"
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
	slog.Debug("CampMinder authenticating", "clientID", c.clientID)

	req, err := http.NewRequest("GET", authURL, http.NoBody)
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

	slog.Debug("CampMinder authentication successful")

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

	req, err := http.NewRequest(method, fullURL, http.NoBody)
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
		req, err = http.NewRequest(method, fullURL, http.NoBody)
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
//
//nolint:dupl // Similar pattern to GetSessionGroups, intentional for different endpoints
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
func (c *Client) GetAttendeesPage(page, pageSize int) (results []map[string]interface{}, hasMore bool, err error) {
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

	hasMore = response.Next != nil && *response.Next != ""
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
	values.Add("includetags", "true")
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
func (c *Client) GetPersonsPage(page, pageSize int) (results []map[string]interface{}, hasMore bool, err error) {
	params := map[string]string{
		"clientid":                c.clientID,
		"pagenumber":              strconv.Itoa(page),
		"pagesize":                strconv.Itoa(pageSize),
		"includecamperdetails":    "true",
		"includecontactdetails":   "true",
		"includerelatives":        "true",
		"includefamilypersons":    "true",
		"includehouseholddetails": "true",
		"includetags":             "true",
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

	hasMore = response.Next != nil && *response.Next != ""
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
func (c *Client) GetBunkPlansPage(page, pageSize int) (results []map[string]interface{}, hasMore bool, err error) {
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

	hasMore = response.Next != nil && *response.Next != ""
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
//
//nolint:dupl // Similar pattern to GetSessions, intentional for different endpoints
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
// Note: This endpoint returns a raw array, not a paginated response
func (c *Client) GetPersonTagDefinitions() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid": c.clientID,
	}

	body, err := c.makeRequest("GET", "persons/tags", params)
	if err != nil {
		return nil, err
	}

	// This endpoint returns a raw array, not a paginated response
	var results []map[string]interface{}
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("decode person tag definitions response: %w", err)
	}

	return results, nil
}

// GetCustomFieldDefinitionsPage retrieves custom field definitions with pagination
// Endpoint: GET /persons/custom-fields
// Returns: array of custom field definitions with Id, Name, DataType, Partition, IsSeasonal, IsArray, IsActive
func (c *Client) GetCustomFieldDefinitionsPage(
	page, pageSize int,
) (results []map[string]interface{}, hasMore bool, err error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"pagenumber": strconv.Itoa(page),
		"pagesize":   strconv.Itoa(pageSize),
	}

	body, err := c.makeRequest("GET", "persons/custom-fields", params)
	if err != nil {
		return nil, false, err
	}

	// CampMinder uses inconsistent casing across endpoints
	// /persons/custom-fields uses camelCase: totalCount, next, result
	var response struct {
		TotalCount int                      `json:"totalCount"`
		Next       *string                  `json:"next"`
		Result     []map[string]interface{} `json:"result"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode custom field definitions response: %w", err)
	}

	hasMore = response.Next != nil && *response.Next != ""
	return response.Result, hasMore, nil
}

// GetPersonCustomFieldValuesPage retrieves custom field values for a specific person with pagination
// Endpoint: GET /persons/{id}/custom-fields
// Returns: array of custom field values with id, clientId, seasonId, value, lastUpdated (camelCase)
// Note: Requires 1 API call per person - use sparingly
//
//nolint:dupl // Similar pattern to GetHouseholdCustomFieldValuesPage, intentional for person variant
func (c *Client) GetPersonCustomFieldValuesPage(
	personID, page, pageSize int,
) (results []map[string]interface{}, hasMore bool, err error) {
	endpoint := fmt.Sprintf("persons/%d/custom-fields", personID)
	params := map[string]string{
		"clientid":   c.clientID,
		"seasonid":   strconv.Itoa(c.seasonID),
		"pagenumber": strconv.Itoa(page),
		"pagesize":   strconv.Itoa(pageSize),
	}

	body, err := c.makeRequest("GET", endpoint, params)
	if err != nil {
		return nil, false, err
	}

	// CampMinder uses camelCase for custom field endpoints
	var response struct {
		TotalCount int                      `json:"totalCount"`
		Next       *string                  `json:"next"`
		Result     []map[string]interface{} `json:"result"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode person custom field values response: %w", err)
	}

	hasMore = response.Next != nil && *response.Next != ""
	return response.Result, hasMore, nil
}

// GetHouseholdCustomFieldValuesPage retrieves custom field values for a specific household with pagination
// Endpoint: GET /persons/households/{id}/custom-fields
// Returns: array of custom field values with id, clientId, seasonId, value, lastUpdated (camelCase)
// Note: Requires 1 API call per household - use sparingly
//
//nolint:dupl // Similar pattern to GetPersonCustomFieldValuesPage, intentional for household variant
func (c *Client) GetHouseholdCustomFieldValuesPage(
	householdID, page, pageSize int,
) (results []map[string]interface{}, hasMore bool, err error) {
	endpoint := fmt.Sprintf("persons/households/%d/custom-fields", householdID)
	params := map[string]string{
		"clientid":   c.clientID,
		"seasonid":   strconv.Itoa(c.seasonID),
		"pagenumber": strconv.Itoa(page),
		"pagesize":   strconv.Itoa(pageSize),
	}

	body, err := c.makeRequest("GET", endpoint, params)
	if err != nil {
		return nil, false, err
	}

	// CampMinder uses camelCase for custom field endpoints
	var response struct {
		TotalCount int                      `json:"totalCount"`
		Next       *string                  `json:"next"`
		Result     []map[string]interface{} `json:"result"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode household custom field values response: %w", err)
	}

	hasMore = response.Next != nil && *response.Next != ""
	return response.Result, hasMore, nil
}

// GetDivisions retrieves all division definitions from CampMinder
// Endpoint: GET /divisions
// Returns: array of divisions with ID, Name, Description, GradeRange, GenderID, Capacity, etc.
// Note: Divisions are global (not year-specific) - they define age/gender groups
func (c *Client) GetDivisions() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"pagenumber": "1",
		"pagesize":   "500", // Get all divisions in one call (typically < 50)
	}

	body, err := c.makeRequest("GET", "divisions", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode divisions response: %w", err)
	}

	return response.Results, nil
}

// GetStaffProgramAreas retrieves staff program area definitions from CampMinder
// Endpoint: GET /staff/programareas
// Returns: array of program areas with ID, Name
// Note: Global lookup table (not year-specific)
func (c *Client) GetStaffProgramAreas() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"pagenumber": "1",
		"pagesize":   "500", // Get all in one call (typically < 100)
	}

	body, err := c.makeRequest("GET", "staff/programareas", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode staff program areas response: %w", err)
	}

	return response.Results, nil
}

// GetStaffOrgCategories retrieves staff organizational category definitions from CampMinder
// Endpoint: GET /staff/organizationalcategories
// Returns: array of org categories with ID, Name
// Note: Global lookup table (not year-specific)
func (c *Client) GetStaffOrgCategories() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"pagenumber": "1",
		"pagesize":   "500", // Get all in one call (typically < 100)
	}

	body, err := c.makeRequest("GET", "staff/organizationalcategories", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode staff org categories response: %w", err)
	}

	return response.Results, nil
}

// GetStaffPositions retrieves staff position definitions from CampMinder
// Endpoint: GET /staff/positions
// Returns: array of positions with ID, Name, ProgramAreaID, ProgramAreaName
// Note: Global lookup table (not year-specific)
func (c *Client) GetStaffPositions() ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"pagenumber": "1",
		"pagesize":   "500", // Get all in one call (typically < 100)
	}

	body, err := c.makeRequest("GET", "staff/positions", params)
	if err != nil {
		return nil, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, fmt.Errorf("decode staff positions response: %w", err)
	}

	return response.Results, nil
}

// GetStaffPage retrieves staff records with pagination
// Endpoint: GET /staff
// Parameters: seasonid (year), status (1=Active, 2=Resigned, 3=Dismissed, 4=Canceled)
// Returns: array of staff with PersonID, StatusID, Position1ID, Position2ID, BunkAssignments, etc.
func (c *Client) GetStaffPage(status, page, pageSize int) (results []map[string]interface{}, hasMore bool, err error) {
	params := map[string]string{
		"clientid":   c.clientID,
		"seasonid":   strconv.Itoa(c.seasonID),
		"status":     strconv.Itoa(status),
		"pagenumber": strconv.Itoa(page),
		"pagesize":   strconv.Itoa(pageSize),
	}

	body, err := c.makeRequest("GET", "staff", params)
	if err != nil {
		return nil, false, err
	}

	var response struct {
		TotalCount int                      `json:"TotalCount"`
		Next       *string                  `json:"Next"`
		Results    []map[string]interface{} `json:"Results"`
	}

	if err := json.Unmarshal(body, &response); err != nil {
		return nil, false, fmt.Errorf("decode staff response: %w", err)
	}

	hasMore = response.Next != nil && *response.Next != ""
	return response.Results, hasMore, nil
}

// GetFinancialCategories retrieves financial category definitions from CampMinder
// Endpoint: GET /financials/financialcategories
// Returns: array of categories with id, name, isArchived
// Note: Global lookup table (not year-specific)
func (c *Client) GetFinancialCategories(includeArchived bool) ([]map[string]interface{}, error) {
	params := map[string]string{
		"clientid":        c.clientID,
		"includeArchived": strconv.FormatBool(includeArchived),
		"pagenumber":      "1",
		"pagesize":        "500", // Get all in one call (typically < 100)
	}

	body, err := c.makeRequest("GET", "financials/financialcategories", params)
	if err != nil {
		return nil, err
	}

	// CampMinder uses inconsistent casing across endpoints
	// Try PascalCase paginated response first (TotalCount, Results)
	var pascalResponse struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}
	if err := json.Unmarshal(body, &pascalResponse); err == nil && pascalResponse.Results != nil {
		return pascalResponse.Results, nil
	}

	// Try camelCase paginated response (totalCount, result - singular like custom fields)
	var camelResponse struct {
		TotalCount int                      `json:"totalCount"`
		Result     []map[string]interface{} `json:"result"`
	}
	if err := json.Unmarshal(body, &camelResponse); err == nil && camelResponse.Result != nil {
		return camelResponse.Result, nil
	}

	// Try camelCase with plural results
	var camelPluralResponse struct {
		TotalCount int                      `json:"totalCount"`
		Results    []map[string]interface{} `json:"results"`
	}
	if err := json.Unmarshal(body, &camelPluralResponse); err == nil && camelPluralResponse.Results != nil {
		return camelPluralResponse.Results, nil
	}

	// Fall back to raw array response (API may return either)
	var results []map[string]interface{}
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("decode financial categories response: %w", err)
	}

	return results, nil
}

// GetPaymentMethods retrieves payment method definitions from CampMinder
// Endpoint: GET /financials/paymentmethods
// Returns: array of methods with id, name
// Note: Global lookup table (not year-specific)
func (c *Client) GetPaymentMethods() ([]map[string]interface{}, error) {
	// This endpoint doesn't take any parameters per the OpenAPI spec
	body, err := c.makeRequest("GET", "financials/paymentmethods", nil)
	if err != nil {
		return nil, err
	}

	// CampMinder uses inconsistent casing - try paginated responses first
	// Try PascalCase
	var pascalResponse struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}
	if err := json.Unmarshal(body, &pascalResponse); err == nil && pascalResponse.Results != nil {
		return pascalResponse.Results, nil
	}

	// Try camelCase with singular result
	var camelResponse struct {
		TotalCount int                      `json:"totalCount"`
		Result     []map[string]interface{} `json:"result"`
	}
	if err := json.Unmarshal(body, &camelResponse); err == nil && camelResponse.Result != nil {
		return camelResponse.Result, nil
	}

	// Try camelCase with plural results
	var camelPluralResponse struct {
		TotalCount int                      `json:"totalCount"`
		Results    []map[string]interface{} `json:"results"`
	}
	if err := json.Unmarshal(body, &camelPluralResponse); err == nil && camelPluralResponse.Results != nil {
		return camelPluralResponse.Results, nil
	}

	// Fall back to raw array response
	var results []map[string]interface{}
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("decode payment methods response: %w", err)
	}

	return results, nil
}

// GetTransactionDetails retrieves financial transaction details from CampMinder
// Endpoint: GET /financials/transactionreporting/transactiondetails
// Parameters: season (required), includeReversals (optional, default false)
// Returns: array of transactions with full detail (see TransactionDetail schema)
// Note: Year-scoped data - uses seasonID
// Note: This endpoint doesn't support pagination, so we fetch by month chunks
// to avoid timeouts on large datasets (10,000+ transactions)
func (c *Client) GetTransactionDetails(season int, includeReversals bool) ([]map[string]interface{}, error) {
	var allResults []map[string]interface{}

	// Fetch transactions month by month to avoid timeout on large datasets
	// Camp season typically runs Jan-Dec, so we cover the full year
	for month := 1; month <= 12; month++ {
		// Calculate month date range
		startDate := time.Date(season, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
		endDate := startDate.AddDate(0, 1, -1) // Last day of month

		params := map[string]string{
			"clientid":         c.clientID,
			"season":           strconv.Itoa(season),
			"includeReversals": strconv.FormatBool(includeReversals),
			"postDateStart":    startDate.Format("2006-01-02"),
			"postDateEnd":      endDate.Format("2006-01-02"),
		}

		slog.Info("Fetching transactions", "month", fmt.Sprintf("%d/12", month), "year", season)

		body, err := c.makeRequest("GET", "financials/transactionreporting/transactiondetails", params)
		if err != nil {
			return nil, fmt.Errorf("fetch transactions for month %d: %w", month, err)
		}

		results, err := c.parseTransactionResponse(body)
		if err != nil {
			return nil, fmt.Errorf("parse transactions for month %d: %w", month, err)
		}

		allResults = append(allResults, results...)
		slog.Info("Fetched transactions",
			"month", fmt.Sprintf("%d/12", month),
			"batch", len(results),
			"total", len(allResults))
	}

	return allResults, nil
}

// parseTransactionResponse parses the transaction details API response
// CampMinder uses inconsistent casing across endpoints
func (c *Client) parseTransactionResponse(body []byte) ([]map[string]interface{}, error) {
	// Try PascalCase paginated response
	var pascalResponse struct {
		TotalCount int                      `json:"TotalCount"`
		Results    []map[string]interface{} `json:"Results"`
	}
	if err := json.Unmarshal(body, &pascalResponse); err == nil && pascalResponse.Results != nil {
		return pascalResponse.Results, nil
	}

	// Try camelCase with singular result
	var camelResponse struct {
		TotalCount int                      `json:"totalCount"`
		Result     []map[string]interface{} `json:"result"`
	}
	if err := json.Unmarshal(body, &camelResponse); err == nil && camelResponse.Result != nil {
		return camelResponse.Result, nil
	}

	// Try camelCase with plural results
	var camelPluralResponse struct {
		TotalCount int                      `json:"totalCount"`
		Results    []map[string]interface{} `json:"results"`
	}
	if err := json.Unmarshal(body, &camelPluralResponse); err == nil && camelPluralResponse.Results != nil {
		return camelPluralResponse.Results, nil
	}

	// Fall back to raw array response
	var results []map[string]interface{}
	if err := json.Unmarshal(body, &results); err != nil {
		return nil, fmt.Errorf("decode transaction details response: %w", err)
	}

	return results, nil
}
