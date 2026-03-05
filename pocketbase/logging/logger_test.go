// Package logging tests - TDD tests written BEFORE implementation
package logging

import (
	"bytes"
	"log/slog"
	"regexp"
	"strings"
	"testing"
)

// TestISO8601Format verifies the timestamp format matches the spec
func TestISO8601Format(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	logger := NewLogger("test", &buf)

	logger.Info("Test message")

	output := buf.String()
	// Format: 2026-01-06T14:05:52Z [test] INFO Test message
	pattern := `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[test\] INFO Test message\n$`
	matched, err := regexp.MatchString(pattern, output)
	if err != nil {
		t.Fatalf("Regex error: %v", err)
	}
	if !matched {
		t.Errorf("Output %q doesn't match expected format (pattern: %s)", output, pattern)
	}
}

// TestSourceTagInBrackets verifies source is wrapped in brackets
func TestSourceTagInBrackets(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	logger := NewLogger("pocketbase", &buf)

	logger.Info("Server started")

	output := buf.String()
	if !strings.Contains(output, "[pocketbase]") {
		t.Errorf("Source tag [pocketbase] not found in output: %s", output)
	}
}

// TestDifferentLogLevels verifies all log levels work correctly
func TestDifferentLogLevels(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	tests := []struct {
		level    slog.Level
		levelStr string
		logFunc  func(*slog.Logger, string)
	}{
		{slog.LevelDebug, "DEBUG", func(l *slog.Logger, m string) { l.Debug(m) }},
		{slog.LevelInfo, "INFO", func(l *slog.Logger, m string) { l.Info(m) }},
		{slog.LevelWarn, "WARN", func(l *slog.Logger, m string) { l.Warn(m) }},
		{slog.LevelError, "ERROR", func(l *slog.Logger, m string) { l.Error(m) }},
	}

	for _, tt := range tests {
		t.Run(tt.levelStr, func(t *testing.T) {
			var buf bytes.Buffer
			logger := NewLoggerWithLevel("test", &buf, slog.LevelDebug)

			tt.logFunc(logger, "Test")

			output := buf.String()
			if !strings.Contains(output, tt.levelStr) {
				t.Errorf("Level %s not found in output: %s", tt.levelStr, output)
			}
		})
	}
}

// TestMessageWithAttributes verifies attributes are included
func TestMessageWithAttributes(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	logger := NewLogger("test", &buf)

	logger.Info("User logged in", "user", "alice", "ip", "192.168.1.1")

	output := buf.String()
	if !strings.Contains(output, "user=alice") {
		t.Errorf("Attribute user=alice not found in output: %s", output)
	}
	if !strings.Contains(output, "ip=192.168.1.1") {
		t.Errorf("Attribute ip=192.168.1.1 not found in output: %s", output)
	}
}

// TestTimestampIsUTC verifies timestamp ends with Z (UTC indicator)
func TestTimestampIsUTC(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	logger := NewLogger("test", &buf)

	logger.Info("Test")

	output := buf.String()
	// Extract timestamp (first field before space)
	timestamp := strings.Split(output, " ")[0]
	if !strings.HasSuffix(timestamp, "Z") {
		t.Errorf("Timestamp %s should end with Z (UTC indicator)", timestamp)
	}
}

// TestInitSetsDefaultLogger verifies Init configures slog.Default
func TestInitSetsDefaultLogger(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	InitWithWriter("myservice", &buf)

	// Use slog.Default() which should now be configured
	slog.Info("Test message from default logger")

	output := buf.String()
	if !strings.Contains(output, "Test message from default logger") {
		t.Errorf("Message not found in output: %s", output)
	}
	if !strings.Contains(output, "[myservice]") {
		t.Errorf("Source tag [myservice] not found in output: %s", output)
	}
}

// TestInitWithWriter verifies InitWithWriter correctly sets up the logger
func TestInitWithWriter(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	InitWithWriter("testservice", &buf)

	slog.Info("Starting sync scheduler...")

	output := buf.String()
	if !strings.Contains(output, "Starting sync scheduler...") {
		t.Errorf("Message not found in output: %s", output)
	}
}

// TestLogLevelFromEnv verifies LOG_LEVEL environment variable is respected
func TestLogLevelFromEnv(t *testing.T) {
	// This test would need to be run with LOG_LEVEL=DEBUG set
	// For now, just verify the default is INFO
	var buf bytes.Buffer
	logger := NewLogger("test", &buf)

	// DEBUG should be filtered at default INFO level
	logger.Debug("Debug message")
	if buf.Len() > 0 {
		t.Errorf("DEBUG message should be filtered at INFO level, got: %s", buf.String())
	}

	// INFO should pass through
	logger.Info("Info message")
	if buf.Len() == 0 {
		t.Error("INFO message should be logged at INFO level")
	}
}

// TestCompactModeOmitsTimestampAndSource verifies compact mode strips timestamp and source
func TestCompactModeOmitsTimestampAndSource(t *testing.T) {
	t.Setenv("LOG_COMPACT", "true")
	var buf bytes.Buffer
	logger := NewLogger("pocketbase", &buf)

	logger.Info("Registered sync service")

	output := strings.TrimSpace(buf.String())
	expected := "INFO Registered sync service"
	if output != expected {
		t.Errorf("Compact output should be %q, got %q", expected, output)
	}
}

// TestCompactModeKeepsSubLabels verifies sub-labels (with /) are preserved in compact mode
func TestCompactModeKeepsSubLabels(t *testing.T) {
	t.Setenv("LOG_COMPACT", "true")
	var buf bytes.Buffer
	logger := NewLogger("sync/sessions", &buf)

	logger.Info("Starting session sync")

	output := strings.TrimSpace(buf.String())
	expected := "[sync/sessions] INFO Starting session sync"
	if output != expected {
		t.Errorf("Compact sub-label output should be %q, got %q", expected, output)
	}
}

// TestCompactModeDisabledShowsFullFormat verifies LOG_COMPACT=false produces full format
func TestCompactModeDisabledShowsFullFormat(t *testing.T) {
	t.Setenv("LOG_COMPACT", "false")
	var buf bytes.Buffer
	logger := NewLogger("pocketbase", &buf)

	logger.Info("Server started")

	output := buf.String()
	// Should have full format: timestamp [source] LEVEL message
	pattern := `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z \[pocketbase\] INFO Server started\n$`
	matched, err := regexp.MatchString(pattern, output)
	if err != nil {
		t.Fatalf("Regex error: %v", err)
	}
	if !matched {
		t.Errorf("Full format output %q doesn't match pattern %s", output, pattern)
	}
}

// TestCompactModeWithAttributes verifies attributes still appear in compact mode
func TestCompactModeWithAttributes(t *testing.T) {
	t.Setenv("LOG_COMPACT", "true")
	var buf bytes.Buffer
	logger := NewLogger("pocketbase", &buf)

	logger.Info("Registered sync", "name", "staff_skills")

	output := strings.TrimSpace(buf.String())
	expected := "INFO Registered sync name=staff_skills"
	if output != expected {
		t.Errorf("Compact output with attrs should be %q, got %q", expected, output)
	}
}
