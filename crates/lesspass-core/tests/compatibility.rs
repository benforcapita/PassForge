use lesspass_core::{
    CryptoConfig, PasswordOptions, PasswordProfile, SaltField, build_fingerprint_hash,
    calc_entropy, create_fingerprint, render_password,
};

fn full_options(length: usize) -> PasswordOptions {
    PasswordOptions {
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
        length,
    }
}

#[test]
fn generates_known_lesspass_password() {
    let profile = PasswordProfile {
        site: "example.org".into(),
        login: "contact@example.org".into(),
        counter: 1,
        options: full_options(16),
        salt_fields: vec![],
        crypto: None,
    };

    let entropy = calc_entropy(&profile, "password", &CryptoConfig::default());
    let password = render_password(&entropy, &profile.options).unwrap();

    assert_eq!(password, "WHLpUL)e00[iHR+w");
}

#[test]
fn salt_fields_are_sorted_by_key_then_value() {
    let mut profile = PasswordProfile {
        site: "example.com".into(),
        login: "me@example.com".into(),
        counter: 2,
        options: full_options(16),
        salt_fields: vec![
            SaltField {
                key: "z".into(),
                value: "2".into(),
            },
            SaltField {
                key: "a".into(),
                value: "2".into(),
            },
            SaltField {
                key: "a".into(),
                value: "1".into(),
            },
        ],
        crypto: None,
    };

    let first = profile.build_salt();
    profile.salt_fields.reverse();
    let second = profile.build_salt();

    assert_eq!(first, second);
    assert_eq!(first, "example.comme@example.com2a:1|a:2|z:2");
}

#[test]
fn validates_length_can_fit_enabled_rules() {
    let options = PasswordOptions {
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
        length: 3,
    };

    let result = render_password(
        "e99e20abab609cc4564ef137acb540de20d9b92dcc5cda58f78ba431444ef2da",
        &options,
    );

    assert_eq!(
        result.unwrap_err().to_string(),
        "password length 3 cannot fit 4 required character rules"
    );
}

#[test]
fn creates_known_fingerprint() {
    let hash = build_fingerprint_hash("password");
    let fingerprint = create_fingerprint(&hash).unwrap();

    assert_eq!(
        serde_json::to_value(fingerprint).unwrap(),
        serde_json::json!([
            { "color": "#490092", "icon": "fa-briefcase" },
            { "color": "#B66DFF", "icon": "fa-graduation-cap" },
            { "color": "#FF6CB6", "icon": "fa-comment" }
        ])
    );
}

#[test]
fn crypto_config_validation_rejects_out_of_range_parameters() {
    assert!(CryptoConfig::default().validate().is_ok());
    let bad = |iterations, keylen, digest: &str| CryptoConfig {
        iterations,
        keylen,
        digest: digest.into(),
    };
    assert!(bad(100_000, 0, "sha256").validate().is_err());
    assert!(bad(100_000, 1, "sha256").validate().is_err());
    assert!(bad(100_000, 1 << 30, "sha256").validate().is_err());
    assert!(bad(1, 32, "sha256").validate().is_err());
    assert!(bad(u32::MAX, 32, "sha256").validate().is_err());
    assert!(bad(100_000, 32, "md5").validate().is_err());
    assert!(bad(100_000, 64, "SHA-512").validate().is_ok());
}

#[test]
fn password_options_validation_rejects_unrenderable_options() {
    assert!(PasswordOptions::default().validate().is_ok());
    assert!(full_options(1_000_000).validate().is_err());
    assert!(full_options(3).validate().is_err());
    let none = PasswordOptions {
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
        length: 16,
    };
    assert!(none.validate().is_err());
}
