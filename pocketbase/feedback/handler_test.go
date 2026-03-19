package feedback

import (
	"testing"
)

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "simple filename unchanged",
			input: "screenshot.png",
			want:  "screenshot.png",
		},
		{
			name:  "strips parent directory traversal",
			input: "../../evil.png",
			want:  "evil.png",
		},
		{
			name:  "strips deep traversal",
			input: "../../../.github/workflows/pwn.yml",
			want:  "pwn.yml",
		},
		{
			name:  "strips leading path components",
			input: "path/to/file.png",
			want:  "file.png",
		},
		{
			name:  "handles filename with spaces",
			input: "Screen Shot 2026-03-11.png",
			want:  "Screen Shot 2026-03-11.png",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sanitizeFilename(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeFilename(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestValidateDescriptionRejectsWhitespace(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		wantVal string
	}{
		{"empty string rejected", "", true, ""},
		{"whitespace-only rejected", "   ", true, ""},
		{"tabs-only rejected", "\t\t", true, ""},
		{"newlines-only rejected", "\n\n", true, ""},
		{"valid description passes", "The button is broken", false, "The button is broken"},
		{"trims surrounding whitespace", "  hello  ", false, "hello"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := validateDescription(tt.input)
			if tt.wantErr && err == nil {
				t.Errorf("validateDescription(%q) expected error", tt.input)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("validateDescription(%q) unexpected error: %v", tt.input, err)
			}
			if !tt.wantErr && got != tt.wantVal {
				t.Errorf("validateDescription(%q) = %q, want %q", tt.input, got, tt.wantVal)
			}
		})
	}
}

func TestValidateScreenshotContent(t *testing.T) {
	tests := []struct {
		name    string
		data    []byte
		wantErr bool
	}{
		{
			name:    "valid PNG accepted",
			data:    []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52},
			wantErr: false,
		},
		{
			name:    "valid JPEG accepted",
			data:    []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01},
			wantErr: false,
		},
		{
			name:    "valid GIF accepted",
			data:    []byte{0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00},
			wantErr: false,
		},
		{
			name: "valid WebP accepted",
			// http.DetectContentType needs at least the RIFF....WEBPVP8 header
			data:    []byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x00\x00"),
			wantErr: false,
		},
		{
			name:    "text file rejected",
			data:    []byte("This is not an image file"),
			wantErr: true,
		},
		{
			name:    "HTML file rejected",
			data:    []byte("<html><body>hello</body></html>"),
			wantErr: true,
		},
		{
			name:    "JSON file rejected",
			data:    []byte(`{"key": "value"}`),
			wantErr: true,
		},
		{
			name:    "empty data rejected",
			data:    []byte{},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateScreenshotContent(tt.data)
			if tt.wantErr && err == nil {
				t.Errorf("validateScreenshotContent(%q) expected error", tt.name)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("validateScreenshotContent(%q) unexpected error: %v", tt.name, err)
			}
		})
	}
}
