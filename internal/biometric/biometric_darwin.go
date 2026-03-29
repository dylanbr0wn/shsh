//go:build darwin

package biometric

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework LocalAuthentication -framework Security -framework Foundation
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <Foundation/Foundation.h>
#include <string.h>

// checkBiometric returns 1 if Touch ID is available, 0 otherwise.
static int checkBiometric() {
    @autoreleasepool {
        LAContext *ctx = [[LAContext alloc] init];
        NSError *err = nil;
        BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&err];
        return ok ? 1 : 0;
    }
}

// storeDerivedKey stores a key in the Keychain with biometric access control.
static int32_t storeDerivedKey(const void *keyData, int keyLen) {
    @autoreleasepool {
        SecAccessControlRef acl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAccessControlBiometryCurrentSet,
            NULL
        );
        if (!acl) return -1;

        NSData *data = [NSData dataWithBytes:keyData length:keyLen];

        // Delete any existing item first
        NSDictionary *delQuery = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
        };
        SecItemDelete((__bridge CFDictionaryRef)delQuery);

        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
            (__bridge id)kSecValueData: data,
            (__bridge id)kSecAttrAccessControl: (__bridge id)acl,
            (__bridge id)kSecUseAuthenticationContext: [[LAContext alloc] init],
        };

        OSStatus status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
        CFRelease(acl);
        return (int32_t)status;
    }
}

// retrieveDerivedKey retrieves the key from Keychain (triggers Touch ID).
static int32_t retrieveDerivedKey(void *buf, int bufLen, int *outLen) {
    @autoreleasepool {
        LAContext *ctx = [[LAContext alloc] init];
        ctx.localizedReason = @"Unlock shsh vault";

        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
            (__bridge id)kSecReturnData: @YES,
            (__bridge id)kSecUseAuthenticationContext: ctx,
        };

        CFTypeRef result = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        if (status != errSecSuccess) {
            return (int32_t)status;
        }

        NSData *objcData = (__bridge_transfer NSData *)result;
        int len = (int)objcData.length;
        if (len > bufLen) len = bufLen;
        memcpy(buf, objcData.bytes, len);
        *outLen = len;
        return 0;
    }
}

// deleteDerivedKey removes the stored key from Keychain.
static int32_t deleteDerivedKey() {
    @autoreleasepool {
        NSDictionary *query = @{
            (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
            (__bridge id)kSecAttrService: @"shsh-vault",
            (__bridge id)kSecAttrAccount: @"derived-key",
        };
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
        if (status == errSecItemNotFound) return 0;
        return (int32_t)status;
    }
}
*/
import "C"
import (
	"errors"
	"fmt"
	"unsafe"
)

var ErrUnsupported = errors.New("biometric: not supported on this platform")

func Available() bool {
	return C.checkBiometric() == 1
}

func StoreKey(key []byte) error {
	if !Available() {
		return ErrUnsupported
	}
	status := C.storeDerivedKey(unsafe.Pointer(&key[0]), C.int(len(key)))
	if status != 0 {
		return fmt.Errorf("biometric: store key failed (OSStatus %d)", status)
	}
	return nil
}

func RetrieveKey() ([]byte, error) {
	if !Available() {
		return nil, ErrUnsupported
	}
	buf := make([]byte, 64)
	var outLen C.int
	status := C.retrieveDerivedKey(unsafe.Pointer(&buf[0]), C.int(len(buf)), &outLen)
	if status != 0 {
		return nil, fmt.Errorf("biometric: retrieve key failed (OSStatus %d)", status)
	}
	return buf[:outLen], nil
}

func DeleteKey() error {
	status := C.deleteDerivedKey()
	if status != 0 {
		return fmt.Errorf("biometric: delete key failed (OSStatus %d)", status)
	}
	return nil
}
