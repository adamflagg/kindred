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

// The questions endpoint returns an OBJECT keyed by question id, and has been
// seen with qid/order as numbers as well as strings (the POST example). Only
// questions staff could map are kept: headers, page breaks, buttons and
// static text carry wording that would mislead the guesser.
const questionsBody = `{"responseCode":200,"message":"success","content":{
 "1":{"qid":"1","order":"1","text":"Weekend registration","type":"control_head","name":"header"},
 "4":{"qid":"4","order":"3","text":"Name","type":"control_fullname","name":"name"},
 "3":{"qid":3,"order":2,"text":"Email","type":"control_email","name":"email"},
 "9":{"qid":"9","order":"9","text":"Submit","type":"control_button"},
 "8":{"qid":"8","order":"8","text":"<p>Thanks!</p>","type":"control_text"},
 "7":{"qid":"7","order":"7","text":"","type":"control_pagebreak"},
 "21":{"qid":"21","order":"21","text":"Bunking request","type":"control_textarea","required":"No"}
}}`

func TestFormQuestionsReadsTheDefinitionInOrder(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("APIKEY") != "k" {
			t.Errorf("APIKEY header = %q", r.Header.Get("APIKEY"))
		}
		if r.URL.Path != "/form/261700000000001/questions" {
			t.Errorf("path = %q", r.URL.Path)
		}
		fmt.Fprint(w, questionsBody)
	}))
	defer server.Close()

	client, _ := NewClient(Config{APIKey: "k", BaseURL: server.URL})
	qs, err := client.FormQuestions(context.Background(), "261700000000001")
	if err != nil {
		t.Fatal(err)
	}
	want := []FormQuestion{
		{QuestionID: "3", Text: "Email", Type: "control_email", Order: 2},
		{QuestionID: "4", Text: "Name", Type: "control_fullname", Order: 3},
		{QuestionID: "21", Text: "Bunking request", Type: "control_textarea", Order: 21},
	}
	if fmt.Sprint(qs) != fmt.Sprint(want) {
		t.Errorf("questions = %+v\nwant        %+v", qs, want)
	}
}

func TestFormQuestionsOfAFormWithNoneIsEmptyNotAnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"responseCode":200,"message":"success","content":[]}`)
	}))
	defer server.Close()
	client, _ := NewClient(Config{APIKey: "k", BaseURL: server.URL})
	qs, err := client.FormQuestions(context.Background(), "261700000000001")
	if err != nil || len(qs) != 0 {
		t.Errorf("got %v, %v; want no questions and no error", qs, err)
	}
}

func TestFormQuestionsFailsOnAnErrorResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		fmt.Fprint(w, `{"responseCode":401,"message":"You're not authorized to use (/form-id/questions)"}`)
	}))
	defer server.Close()
	client, _ := NewClient(Config{APIKey: "k", BaseURL: server.URL})
	if qs, err := client.FormQuestions(context.Background(), "261700000000001"); err == nil || qs != nil {
		t.Errorf("an error response must fail with no result; got %v, %v", qs, err)
	}
}

func TestFormTitleReadsTheFormInfo(t *testing.T) {
	// The live API answers with an object; the published example wraps it in a
	// one-element array. Both must read.
	for name, body := range map[string]string{
		"object": `{"responseCode":200,"message":"success","content":{"id":"261700000000001","title":"Women's Weekend 2026","status":"ENABLED"}}`,
		"array":  `{"responseCode":200,"message":"success","content":[{"id":"261700000000001","title":"Women's Weekend 2026"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/form/261700000000001" {
					t.Errorf("path = %q", r.URL.Path)
				}
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			client, _ := NewClient(Config{APIKey: "k", BaseURL: server.URL})
			title, err := client.FormTitle(context.Background(), "261700000000001")
			if err != nil || title != "Women's Weekend 2026" {
				t.Errorf("title = %q, err %v", title, err)
			}
		})
	}
}
