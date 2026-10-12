// Package fileperm makes every file this process creates private to the uid it
// runs as.
//
// Every kindred container runs as the same nonroot uid (65532), and the only
// file one container reads that another wrote -- this process's SQLite, which
// kindred-api opens read-only -- is read by that same uid. Nothing needs group
// or other access, so new files are 0600 and new directories 0700.
//
// It is a umask rather than explicit modes because most of what lands in
// pb_data is created by the PocketBase library and SQLite, not by this repo:
// the library writes with 0644 and makes directories with os.ModePerm, and the
// umask is the one setting that reaches all of them. The images are distroless,
// with no shell to run `umask` before the binary starts, so main() sets it as
// its first statement.
//
// A umask only governs files created after it is set. Files that already exist
// keep their modes. SQLite in particular creates data.db-wal and data.db-shm
// with the mode of data.db itself, not from the umask, so an existing data.db
// left at 0644 keeps producing 0644 -wal/-shm files until it is chmodded.
package fileperm

// PrivateUmask withholds every group and other permission bit.
const PrivateUmask = 0o077
