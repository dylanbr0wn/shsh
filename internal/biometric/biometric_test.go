package biometric

import (
	"testing"
)

func TestAvailable_ReturnsWithoutPanic(t *testing.T) {
	_ = Available()
}

func TestStoreAndRetrieve_ErrorOnUnsupported(t *testing.T) {
	if Available() {
		t.Skip("biometric hardware available, skipping stub test")
	}

	err := StoreKey([]byte("test-key-32-bytes-long-xxxxxxxx"))
	if err == nil {
		t.Fatal("StoreKey should return error when biometrics unavailable")
	}

	_, err = RetrieveKey()
	if err == nil {
		t.Fatal("RetrieveKey should return error when biometrics unavailable")
	}
}
