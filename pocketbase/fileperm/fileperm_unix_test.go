//go:build unix

package fileperm

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

// The umask is process-wide, so these tests are deliberately NOT parallel:
// Go runs every top-level non-parallel test before releasing any parallel one,
// and each restores the umask it found in t.Cleanup.

func setUmaskForTest(t *testing.T, mask int) {
	t.Helper()
	before := syscall.Umask(mask)
	t.Cleanup(func() { syscall.Umask(before) })
}

func modeOf(t *testing.T, path string) os.FileMode {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat %s: %v", path, err)
	}
	return info.Mode().Perm()
}

func TestPrivateUmaskWithholdsGroupAndOther(t *testing.T) {
	if PrivateUmask != 0o077 {
		t.Fatalf("PrivateUmask = %#o, want 0o077", PrivateUmask)
	}
}

func TestRestrictNewFilesMakesNewFilesAndDirsOwnerOnly(t *testing.T) {
	setUmaskForTest(t, 0o022)

	previous := RestrictNewFiles()
	if previous != 0o022 {
		t.Errorf("RestrictNewFiles returned %#o, want the previous umask 0o022", previous)
	}

	dir := t.TempDir()
	// The modes the PocketBase library itself passes: 0644 for files it
	// writes, os.ModePerm for the directories it makes.
	file := filepath.Join(dir, "data.db")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	sub := filepath.Join(dir, "storage", "collection")
	if err := os.MkdirAll(sub, os.ModePerm); err != nil {
		t.Fatal(err)
	}

	if got := modeOf(t, file); got != 0o600 {
		t.Errorf("new file mode = %#o, want 0o600", got)
	}
	if got := modeOf(t, sub); got != 0o700 {
		t.Errorf("new dir mode = %#o, want 0o700", got)
	}
}

func TestRestrictNewFilesLeavesExistingFilesAlone(t *testing.T) {
	setUmaskForTest(t, 0o022)

	file := filepath.Join(t.TempDir(), "existing.json")
	if err := os.WriteFile(file, []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	RestrictNewFiles()

	if got := modeOf(t, file); got != 0o644 {
		t.Errorf("existing file mode = %#o, want it untouched at 0o644", got)
	}
}
