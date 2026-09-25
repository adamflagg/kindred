package jotform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const pageOne = `{"responseCode":200,"message":"success","content":[
 {"id":"6600000000000000001","form_id":"261700000000001",
  "created_at":"2026-08-03 09:00:00","updated_at":null,"status":"ACTIVE",
  "answers":{"4":{"name":"firstName","order":"4","text":"First Name","type":"control_textbox","answer":"Olivia"}}},
 {"id":"6600000000000000002","form_id":"261700000000001",
  "created_at":"2026-08-04 09:00:00","updated_at":"2026-08-05 10:00:00","status":"ACTIVE","answers":[]}
],"resultSet":{"offset":0,"limit":2,"count":2}}`

const pageTwo = `{"responseCode":200,"message":"success","content":[
 {"id":"6600000000000000003","form_id":"261700000000001",
  "created_at":"2026-08-06 09:00:00","updated_at":null,"status":"ACTIVE","answers":{}}
],"resultSet":{"offset":2,"limit":2,"count":1}}`

func TestFormSubmissionsPagesUntilAShortPage(t *testing.T) {
	var offsets []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("APIKEY") != "test-key" {
			t.Errorf("APIKEY header = %q, want test-key", r.Header.Get("APIKEY"))
		}
		if strings.Contains(r.URL.RawQuery, "test-key") {
			t.Error("the API key must never travel in the URL, where proxies and logs keep it")
		}
		if r.URL.Path != "/form/261700000000001/submissions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		offsets = append(offsets, r.URL.Query().Get("offset"))
		if r.URL.Query().Get("offset") == "0" {
			fmt.Fprint(w, pageOne)
			return
		}
		fmt.Fprint(w, pageTwo)
	}))
	defer server.Close()

	client, err := NewClient(Config{APIKey: "test-key", BaseURL: server.URL + "/", PageSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	subs, err := client.FormSubmissions(context.Background(), "261700000000001")
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 3 {
		t.Fatalf("got %d submissions, want 3", len(subs))
	}
	if strings.Join(offsets, ",") != "0,2" {
		t.Errorf("offsets = %v, want [0 2]", offsets)
	}
	if subs[0].Answers["4"].Text != "First Name" || subs[1].UpdatedAt != "2026-08-05 10:00:00" {
		t.Errorf("unexpected decode: %+v", subs[:2])
	}
	if len(subs[1].Answers) != 0 {
		t.Error(`"answers": [] must decode as no answers, not fail`)
	}
}

func TestFormSubmissionsFailsWholeOnAnErrorPage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("offset") == "0" {
			fmt.Fprint(w, pageOne)
			return
		}
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprint(w, `{"responseCode":500,"message":"Internal error"}`)
	}))
	defer server.Close()

	client, _ := NewClient(Config{APIKey: "k", BaseURL: server.URL, PageSize: 2})
	subs, err := client.FormSubmissions(context.Background(), "261700000000001")
	if err == nil || subs != nil {
		t.Fatalf("a failed page must fail the whole pull with no partial result; got %d subs, err %v", len(subs), err)
	}
}

func TestNewClientRequiresAKeyAndDefaultsTheBase(t *testing.T) {
	if _, err := NewClient(Config{APIKey: "  "}); !errors.Is(err, ErrNoAPIKey) {
		t.Errorf("err = %v, want ErrNoAPIKey", err)
	}
	c, err := NewClient(Config{APIKey: "k"})
	if err != nil || c.baseURL != DefaultBaseURL || c.pageSize != MaxPageSize {
		t.Errorf("defaults: base %q size %d err %v", c.baseURL, c.pageSize, err)
	}
}

func TestNewClientFromEnvReadsKeyAndBase(t *testing.T) {
	t.Setenv("JOTFORM_API_KEY", "env-key")
	t.Setenv("JOTFORM_API_BASE", "https://example.jotform.com/API")
	c, err := NewClientFromEnv()
	if err != nil || c.apiKey != "env-key" || c.baseURL != "https://example.jotform.com/API" {
		t.Errorf("from env: %+v err %v", c, err)
	}
}
