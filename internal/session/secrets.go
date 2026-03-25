package session

import "unsafe"

// clearString zeros the backing bytes of a string value.
// This is best-effort defense-in-depth: Go may have already copied the string
// elsewhere (e.g., inside third-party libraries like go-keyring or goph), so
// this only guarantees that *our* copy is cleared.
func clearString(s *string) {
	if len(*s) == 0 {
		return
	}
	b := unsafe.Slice(unsafe.StringData(*s), len(*s))
	for i := range b {
		b[i] = 0
	}
	*s = ""
}
