//go:build unix

package fileperm

import "syscall"

// RestrictNewFiles sets the process umask to PrivateUmask and returns the
// previous one.
func RestrictNewFiles() int {
	return syscall.Umask(PrivateUmask)
}
