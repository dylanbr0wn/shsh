//go:build !darwin

package biometric

import "errors"

var ErrUnsupported = errors.New("biometric: not supported on this platform")

func Available() bool              { return false }
func StoreKey(key []byte) error    { return ErrUnsupported }
func RetrieveKey() ([]byte, error) { return nil, ErrUnsupported }
func DeleteKey() error             { return ErrUnsupported }
