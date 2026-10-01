package com.dreamcore.workspace.identity;

/** Mainland numbers may omit +86; all stored identities use a country-prefixed number. */
public final class PhoneNumbers {
    private PhoneNumbers() {}
    public static String normalize(String input) {
        if (input == null || input.length() > 40) throw new IdentityException(400,"PHONE_INVALID");
        String value = input.strip().replace(" ", "").replace("-", "");
        if (value.matches("1[3-9][0-9]{9}")) value = "+86" + value;
        if (!value.matches("\\+[1-9][0-9]{7,14}") || (value.startsWith("+86") && !value.matches("\\+861[3-9][0-9]{9}")))
            throw new IdentityException(400,"PHONE_INVALID");
        return value;
    }
    public static String contact(String phone, String legacyEmail) {
        if ((phone == null) == (legacyEmail == null)) throw IdentityException.invalid();
        return phone != null ? normalize(phone) : IdentityService.email(legacyEmail);
    }
    public static String mask(String phone) {
        return phone.substring(0, Math.min(5,phone.length()-4)) + "****" + phone.substring(phone.length()-4);
    }
}
