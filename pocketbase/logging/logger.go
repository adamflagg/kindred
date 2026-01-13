// Package logging provides consistent structured logging using slog.
//
// This package implements a unified logging format matching the Python side:
// Format: 2026-01-06T14:05:52Z [source] LEVEL message key=value...
//
// Usage:
//
//	// Initialize once at startup
//	logging.Init("pocketbase")
//
//	// Then use slog directly throughout the codebase
//	slog.Info("Server started", "port", 8090)
//	slog.Error("Failed to connect", "error", err)
package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"time"
)

// ISO8601Handler implements slog.Handler with our custom format
type ISO8601Handler struct {
	source string
	level  slog.Level
	writer io.Writer
	attrs  []slog.Attr
	groups []string
}

// NewHandler creates a handler with our custom format
func NewHandler(source string, w io.Writer, level slog.Level) *ISO8601Handler {
	return &ISO8601Handler{
		source: source,
		writer: w,
		level:  level,
	}
}

// Enabled reports whether the handler handles records at the given level
func (h *ISO8601Handler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

// Handle formats and writes the log record
func (h *ISO8601Handler) Handle(_ context.Context, r slog.Record) error {
	// Format: 2026-01-06T14:05:52Z [source] LEVEL message key=value...
	timestamp := r.Time.UTC().Format(time.RFC3339)
	// Replace +00:00 with Z for consistency
	timestamp = strings.TrimSuffix(timestamp, "+00:00") + "Z"
	if strings.HasSuffix(timestamp, "ZZ") {
		timestamp = strings.TrimSuffix(timestamp, "Z")
	}

	level := r.Level.String()

	var buf strings.Builder
	buf.WriteString(timestamp)
	buf.WriteString(" [")
	buf.WriteString(h.source)
	buf.WriteString("] ")
	buf.WriteString(level)
	buf.WriteString(" ")
	buf.WriteString(r.Message)

	// Add precomputed attrs
	for _, a := range h.attrs {
		buf.WriteString(" ")
		buf.WriteString(a.Key)
		buf.WriteString("=")
		buf.WriteString(fmt.Sprintf("%v", a.Value.Any()))
	}

	// Add record attrs
	r.Attrs(func(a slog.Attr) bool {
		buf.WriteString(" ")
		buf.WriteString(a.Key)
		buf.WriteString("=")
		buf.WriteString(fmt.Sprintf("%v", a.Value.Any()))
		return true
	})

	buf.WriteString("\n")

	_, err := h.writer.Write([]byte(buf.String()))
	return err
}

// WithAttrs returns a new handler with the given attributes
func (h *ISO8601Handler) WithAttrs(attrs []slog.Attr) slog.Handler {
	newAttrs := make([]slog.Attr, len(h.attrs)+len(attrs))
	copy(newAttrs, h.attrs)
	copy(newAttrs[len(h.attrs):], attrs)
	return &ISO8601Handler{
		source: h.source,
		writer: h.writer,
		level:  h.level,
		attrs:  newAttrs,
		groups: h.groups,
	}
}

// WithGroup returns a new handler with the given group
func (h *ISO8601Handler) WithGroup(name string) slog.Handler {
	newGroups := make([]string, len(h.groups)+1)
	copy(newGroups, h.groups)
	newGroups[len(h.groups)] = name
	return &ISO8601Handler{
		source: h.source,
		writer: h.writer,
		level:  h.level,
		attrs:  h.attrs,
		groups: newGroups,
	}
}

// NewLogger creates a new slog logger with ISO8601 formatting at INFO level
func NewLogger(source string, w io.Writer) *slog.Logger {
	return NewLoggerWithLevel(source, w, getLevelFromEnv())
}

// NewLoggerWithLevel creates a new slog logger with specified level
func NewLoggerWithLevel(source string, w io.Writer, level slog.Level) *slog.Logger {
	handler := NewHandler(source, w, level)
	return slog.New(handler)
}

// getLevelFromEnv returns the log level from LOG_LEVEL environment variable
func getLevelFromEnv() slog.Level {
	levelStr := os.Getenv("LOG_LEVEL")
	switch strings.ToUpper(levelStr) {
	case "DEBUG":
		return slog.LevelDebug
	case "WARN", "WARNING":
		return slog.LevelWarn
	case "ERROR":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// --- Initialization ---

// Init initializes the default slog logger with the given source
func Init(source string) {
	InitWithWriter(source, os.Stdout)
}

// InitWithWriter initializes the default slog logger with custom writer (for testing)
func InitWithWriter(source string, w io.Writer) {
	logger := NewLogger(source, w)
	slog.SetDefault(logger)
}
