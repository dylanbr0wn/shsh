//go:build darwin && !cgo
// +build darwin,!cgo

package biometric

func available() bool              { return false }
func storeKey(key []byte) error    { return ErrUnsupported }
func retrieveKey() ([]byte, error) { return nil, ErrUnsupported }
func deleteKey() error             { return ErrUnsupported }
