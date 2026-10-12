//go:build !unix

package fileperm

// RestrictNewFiles is a no-op where there is no umask. It returns 0.
func RestrictNewFiles() int {
	return 0
}
