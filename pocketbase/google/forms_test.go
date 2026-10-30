package google

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"google.golang.org/api/forms/v1"
	"google.golang.org/api/option"
)

// The job reads the form and its responses and nothing else (design §12 risk 8):
// exactly the two readonly Forms scopes, never a Drive or write scope.
func TestFormsScopesAreTheTwoReadonlyOnes(t *testing.T) {
	want := []string{
		"https://www.googleapis.com/auth/forms.body.readonly",
		"https://www.googleapis.com/auth/forms.responses.readonly",
	}
	if !slices.Equal(formsScopes, want) {
		t.Errorf("formsScopes = %v, want %v", formsScopes, want)
	}
	for _, s := range formsScopes {
		if strings.Contains(s, "drive") || !strings.HasSuffix(s, ".readonly") {
			t.Errorf("scope %q is not a readonly Forms scope", s)
		}
	}
}

func TestNewFormsClientDisabled(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "false")
	client, err := NewFormsClient(context.Background())
	if err != nil || client != nil {
		t.Errorf("NewFormsClient disabled = (%v, %v), want (nil, nil)", client, err)
	}
}

func TestNewFormsClientEnabledWithoutCredentials(t *testing.T) {
	t.Setenv("GOOGLE_SHEETS_ENABLED", "true")
	t.Setenv("GOOGLE_SERVICE_ACCOUNT_KEY_FILE", "/nonexistent/path/to/credentials.json")
	if _, err := NewFormsClient(context.Background()); err == nil {
		t.Error("want an error when enabled without credentials")
	}
}

func TestDefinitionFromAPI(t *testing.T) {
	t.Parallel()
	form := &forms.Form{
		RevisionId: "00000031",
		Items: []*forms.Item{
			{Title: "Name (First and Last):", QuestionItem: &forms.QuestionItem{Question: &forms.Question{
				QuestionId: "a1", Required: true, TextQuestion: &forms.TextQuestion{},
			}}},
			{Title: "Financial Questions", PageBreakItem: &forms.PageBreakItem{}},
			{Title: "Program", QuestionItem: &forms.QuestionItem{Question: &forms.Question{
				QuestionId: "a2", Required: true, ChoiceQuestion: &forms.ChoiceQuestion{
					Type: "RADIO", Options: []*forms.Option{
						{Value: "Family Camp 1 (May 28 - 31)"}, {Value: "Women's Weekend (October 14 - 17)"},
					},
				},
			}}},
			{Title: "Birthdate", QuestionItem: &forms.QuestionItem{Question: &forms.Question{
				QuestionId: "a3", Required: true, DateQuestion: &forms.DateQuestion{IncludeYear: true},
			}}},
			{Title: "Anything else?", QuestionItem: &forms.QuestionItem{Question: &forms.Question{
				QuestionId: "a4", TextQuestion: &forms.TextQuestion{Paragraph: true},
			}}},
			{Title: "How was it?", QuestionItem: &forms.QuestionItem{Question: &forms.Question{
				QuestionId: "a5", ScaleQuestion: &forms.ScaleQuestion{Low: 1, High: 5},
			}}},
		},
	}
	def := definitionFromAPI(form)
	if def.RevisionID != "00000031" {
		t.Errorf("revision = %q", def.RevisionID)
	}
	want := []FormQuestion{
		{QuestionID: "a1", Title: "Name (First and Last):", Kind: "text", Required: true},
		{QuestionID: "a2", Title: "Program", Kind: "choice", Required: true,
			Options: []string{"Family Camp 1 (May 28 - 31)", "Women's Weekend (October 14 - 17)"}},
		{QuestionID: "a3", Title: "Birthdate", Kind: "date", Required: true},
		{QuestionID: "a4", Title: "Anything else?", Kind: "paragraph"},
		{QuestionID: "a5", Title: "How was it?", Kind: "other"},
	}
	got, _ := json.Marshal(def.Questions)
	exp, _ := json.Marshal(want)
	if !bytes.Equal(got, exp) {
		t.Errorf("questions =\n%s\nwant\n%s", got, exp)
	}
}

func TestResponseFromAPI(t *testing.T) {
	t.Parallel()
	r := responseFromAPI(&forms.FormResponse{
		ResponseId: "r1", CreateTime: "2026-11-05T17:00:00.123Z", LastSubmittedTime: "2026-11-05T17:00:00.123Z",
		RespondentEmail: "test@example.com",
		Answers: map[string]forms.Answer{
			"a1": {QuestionId: "a1", TextAnswers: &forms.TextAnswers{Answers: []*forms.TextAnswer{{Value: "Emma Johnson"}}}},
			"a3": {QuestionId: "a3", TextAnswers: &forms.TextAnswers{Answers: []*forms.TextAnswer{{Value: "1975-07-07"}}}},
			"a9": {QuestionId: "a9"}, // no text answers at all
		},
	})
	if r.ResponseID != "r1" || r.CreateTime != "2026-11-05T17:00:00.123Z" || r.RespondentEmail != "test@example.com" {
		t.Errorf("response = %+v", r)
	}
	if r.Answer("a1") != "Emma Johnson" || r.Answer("a3") != "1975-07-07" || r.Answer("a9") != "" || r.Answer("zz") != "" {
		t.Errorf("answers = %+v", r.Answers)
	}
}

// fakeFormsAPI serves one form and its responses in pages of two, from a local
// test server. No request leaves the machine.
func fakeFormsAPI(t *testing.T, responses int) (srv *httptest.Server, pageSizes *[]string) {
	t.Helper()
	var sizes []string
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/forms/form-1", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"formId": "form-1", "revisionId": "00000007", "items": []any{}})
	})
	mux.HandleFunc("/v1/forms/form-1/responses", func(w http.ResponseWriter, r *http.Request) {
		sizes = append(sizes, r.URL.Query().Get("pageSize"))
		start := 0
		if tok := r.URL.Query().Get("pageToken"); tok != "" {
			start = int(tok[0] - '0')
		}
		var page []map[string]any
		for i := start; i < min(start+2, responses); i++ {
			page = append(page, map[string]any{"responseId": string(rune('a' + i))})
		}
		body := map[string]any{"responses": page}
		if start+2 < responses {
			body["nextPageToken"] = string(rune('0' + start + 2))
		}
		_ = json.NewEncoder(w).Encode(body)
	})
	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, &sizes
}

func TestFormsClientReadsTheDefinitionAndEveryResponsePage(t *testing.T) {
	t.Parallel()
	srv, pageSizes := fakeFormsAPI(t, 5)
	ctx := context.Background()
	client, err := newFormsClientWithOptions(ctx,
		option.WithEndpoint(srv.URL+"/"), option.WithHTTPClient(srv.Client()), option.WithoutAuthentication())
	if err != nil {
		t.Fatal(err)
	}
	def, err := client.Form(ctx, "form-1")
	if err != nil || def.RevisionID != "00000007" {
		t.Fatalf("Form = (%+v, %v)", def, err)
	}
	got, err := client.Responses(ctx, "form-1")
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]string, 0, len(got))
	for _, r := range got {
		ids = append(ids, r.ResponseID)
	}
	if !slices.Equal(ids, []string{"a", "b", "c", "d", "e"}) {
		t.Errorf("response ids = %v, want all five across three pages", ids)
	}
	for _, size := range *pageSizes {
		if size != "5000" {
			t.Errorf("pageSize = %q, want 5000 (the API maximum)", size)
		}
	}
}
