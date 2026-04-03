package biometric

import "errors"

var ErrUnsupported = errors.New("biometric: not supported on this platform")

func Available() bool              { return available() }
func StoreKey(key []byte) error    { return storeKey(key) }
func RetrieveKey() ([]byte, error) { return retrieveKey() }
func DeleteKey() error             { return deleteKey() }
