//go:build ignore

#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <Foundation/Foundation.h>
#include <string.h>

int checkBiometric(void) {
    @autoreleasepool {
        LAContext *ctx = [[LAContext alloc] init];
        NSError *err = nil;
        BOOL ok = [ctx canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&err];
        return ok ? 1 : 0;
    }
}

int32_t storeDerivedKey(const void *keyData, int keyLen) {
    @autoreleasepool {
        SecAccessControlRef acl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecAccessControlBiometryCurrentSet,
            NULL
        );
        if (!acl) return -1;

        NSData *data = [NSData dataWithBytes:keyData length:keyLen];

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

int32_t retrieveDerivedKey(void *buf, int bufLen, int *outLen) {
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

int32_t deleteDerivedKey(void) {
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
