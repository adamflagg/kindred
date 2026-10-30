package google

import (
	"context"
	"fmt"

	"golang.org/x/oauth2/google"
	"google.golang.org/api/forms/v1"
	"google.golang.org/api/option"
)

// formsScopes are the only scopes the adult aid form reader asks for: the
// form's definition and its responses, read-only. Never Drive, never a write
// scope (adult-aid form design §12, risk 8).
var formsScopes = []string{forms.FormsBodyReadonlyScope, forms.FormsResponsesReadonlyScope}

// formsResponsesPageSize is the Forms API's maximum page.
const formsResponsesPageSize = 5000

// FormQuestion is one question of a Google Form, reduced to what Kindred reads.
type FormQuestion struct {
	QuestionID string   `json:"question_id"`
	Title      string   `json:"title"`
	Kind       string   `json:"kind"` // text, paragraph, choice, date, other
	Required   bool     `json:"required"`
	Options    []string `json:"options,omitempty"`
}

// FormDefinition is a form's revision and its questions in form order.
// Section headers and other non-question items are left out.
type FormDefinition struct {
	RevisionID string
	Questions  []FormQuestion
}

// FormResponse is one response: Google's ids and times verbatim (RFC 3339,
// UTC), and each answered question's text answers.
type FormResponse struct {
	ResponseID        string
	CreateTime        string
	LastSubmittedTime string
	RespondentEmail   string
	Answers           map[string][]string
}

// Answer is a question's first text answer, "" when it has none.
func (r *FormResponse) Answer(questionID string) string {
	if values := r.Answers[questionID]; len(values) > 0 {
		return values[0]
	}
	return ""
}

// FormsClient reads Google Forms with the service account.
type FormsClient struct {
	svc *forms.Service
}

// NewFormsClient builds a client from the service account credentials, with
// formsScopes only. It returns nil, nil when Google is disabled
// (GOOGLE_SHEETS_ENABLED), like the Sheets and Drive clients.
func NewFormsClient(ctx context.Context) (*FormsClient, error) {
	if !IsEnabled() {
		return nil, nil
	}
	credJSON, err := getCredentialsJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to get credentials: %w", err)
	}
	config, err := google.JWTConfigFromJSON(credJSON, formsScopes...)
	if err != nil {
		return nil, fmt.Errorf("failed to parse credentials: %w", err)
	}
	return newFormsClientWithOptions(ctx, option.WithHTTPClient(config.Client(ctx)))
}

func newFormsClientWithOptions(ctx context.Context, opts ...option.ClientOption) (*FormsClient, error) {
	svc, err := forms.NewService(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("failed to create forms service: %w", err)
	}
	return &FormsClient{svc: svc}, nil
}

// Form reads a form's definition (forms.get).
func (c *FormsClient) Form(ctx context.Context, formID string) (FormDefinition, error) {
	form, err := c.svc.Forms.Get(formID).Context(ctx).Do()
	if err != nil {
		return FormDefinition{}, fmt.Errorf("reading the form: %w", err)
	}
	return definitionFromAPI(form), nil
}

// Responses reads every response ever submitted (forms.responses.list, every page).
func (c *FormsClient) Responses(ctx context.Context, formID string) ([]FormResponse, error) {
	var out []FormResponse
	err := c.svc.Forms.Responses.List(formID).PageSize(formsResponsesPageSize).Pages(ctx,
		func(page *forms.ListFormResponsesResponse) error {
			for _, r := range page.Responses {
				out = append(out, responseFromAPI(r))
			}
			return nil
		})
	if err != nil {
		return nil, fmt.Errorf("listing the form's responses: %w", err)
	}
	return out, nil
}

func definitionFromAPI(form *forms.Form) FormDefinition {
	def := FormDefinition{RevisionID: form.RevisionId}
	for _, item := range form.Items {
		if item == nil || item.QuestionItem == nil || item.QuestionItem.Question == nil {
			continue
		}
		q := item.QuestionItem.Question
		fq := FormQuestion{QuestionID: q.QuestionId, Title: item.Title, Required: q.Required}
		switch {
		case q.ChoiceQuestion != nil:
			fq.Kind = "choice"
			for _, o := range q.ChoiceQuestion.Options {
				if o != nil && !o.IsOther {
					fq.Options = append(fq.Options, o.Value)
				}
			}
		case q.DateQuestion != nil:
			fq.Kind = "date"
		case q.TextQuestion != nil && q.TextQuestion.Paragraph:
			fq.Kind = "paragraph"
		case q.TextQuestion != nil:
			fq.Kind = "text"
		default:
			fq.Kind = "other"
		}
		def.Questions = append(def.Questions, fq)
	}
	return def
}

func responseFromAPI(r *forms.FormResponse) FormResponse {
	out := FormResponse{
		ResponseID: r.ResponseId, CreateTime: r.CreateTime, LastSubmittedTime: r.LastSubmittedTime,
		RespondentEmail: r.RespondentEmail, Answers: make(map[string][]string, len(r.Answers)),
	}
	for qid, a := range r.Answers {
		if a.TextAnswers == nil {
			continue
		}
		for _, ta := range a.TextAnswers.Answers {
			if ta != nil {
				out.Answers[qid] = append(out.Answers[qid], ta.Value)
			}
		}
	}
	return out
}
