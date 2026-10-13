use hmac::{Hmac, Mac};
use lesspass_core::{
    crypto::get_algorithm,
    render_password,
    types::{CryptoConfig, PasswordOptions, PasswordProfile},
};
use pbkdf2::pbkdf2_hmac;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256, Sha512};
use zeroize::Zeroizing;

pub const PROTOCOL: &str = "passforge-remote-v1";
const SETTINGS_DOMAIN: &[u8] = b"passforge-settings-v1";
const FINISH_DOMAIN: &[u8] = b"passforge-finish-v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AlgorithmInfo {
    pub id: String,
    pub description: String,
    pub portable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InfoResponse {
    pub protocol: String,
    pub name: String,
    pub version: String,
    pub default_algorithm: String,
    pub algorithms: Vec<AlgorithmInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeriveRequest {
    #[serde(default)]
    pub algorithm: Option<String>,
    pub input: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeriveResponse {
    pub algorithm: String,
    pub output: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ErrorResponse {
    pub error: String,
}

pub struct Blinded {
    input: [u8; 32],
    local_key: Zeroizing<[u8; 32]>,
}

impl Blinded {
    pub fn input(&self) -> &[u8; 32] {
        &self.input
    }

    pub fn input_hex(&self) -> String {
        hex::encode(self.input)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ProtocolError {
    #[error("server output must contain at least 32 bytes")]
    ServerOutputTooShort,
    #[error("input must be exactly 32 bytes of hexadecimal")]
    InvalidHexInput,
    #[error(transparent)]
    Render(#[from] lesspass_core::CoreError),
}

pub fn settings_digest(profile: &PasswordProfile) -> [u8; 32] {
    let flags = u8::from(profile.options.lowercase)
        | (u8::from(profile.options.uppercase) << 1)
        | (u8::from(profile.options.digits) << 2)
        | (u8::from(profile.options.symbols) << 3);
    let mut fields: Vec<_> = profile.salt_fields.iter().collect();
    fields.sort_by(|a, b| a.key.cmp(&b.key).then_with(|| a.value.cmp(&b.value)));

    let mut hasher = Sha256::new();
    hasher.update(SETTINGS_DOMAIN);
    hasher.update(profile.counter.to_be_bytes());
    hasher.update([flags]);
    hasher.update((profile.options.length as u32).to_be_bytes());
    hasher.update((fields.len() as u32).to_be_bytes());
    for field in fields {
        update_lp(&mut hasher, field.key.as_bytes());
        update_lp(&mut hasher, field.value.as_bytes());
    }
    hasher.finalize().into()
}

fn update_lp(hasher: &mut Sha256, value: &[u8]) {
    hasher.update((value.len() as u32).to_be_bytes());
    hasher.update(value);
}

pub fn blind(profile: &PasswordProfile, master_password: &str, crypto: &CryptoConfig) -> Blinded {
    let effective_crypto = profile.crypto.as_ref().unwrap_or(crypto);
    let digest = settings_digest(profile);
    let mut salt = Vec::new();
    salt.extend_from_slice(b"passforge-remote-v1");
    append_lp(&mut salt, profile.site.as_bytes());
    append_lp(&mut salt, profile.login.as_bytes());
    salt.extend_from_slice(&digest);

    let mut okm = Zeroizing::new([0u8; 64]);
    match get_algorithm(&effective_crypto.digest) {
        "SHA-1" => pbkdf2_hmac::<Sha1>(
            master_password.as_bytes(),
            &salt,
            effective_crypto.iterations,
            &mut *okm,
        ),
        "SHA-512" => pbkdf2_hmac::<Sha512>(
            master_password.as_bytes(),
            &salt,
            effective_crypto.iterations,
            &mut *okm,
        ),
        _ => pbkdf2_hmac::<Sha256>(
            master_password.as_bytes(),
            &salt,
            effective_crypto.iterations,
            &mut *okm,
        ),
    }

    let mut input = [0u8; 32];
    input.copy_from_slice(&okm[..32]);
    let mut local_key = Zeroizing::new([0u8; 32]);
    local_key.copy_from_slice(&okm[32..]);
    Blinded { input, local_key }
}

fn append_lp(buffer: &mut Vec<u8>, value: &[u8]) {
    buffer.extend_from_slice(&(value.len() as u32).to_be_bytes());
    buffer.extend_from_slice(value);
}

pub fn finish_entropy(blinded: &Blinded, server_output: &[u8]) -> Result<String, ProtocolError> {
    if server_output.len() < 32 {
        return Err(ProtocolError::ServerOutputTooShort);
    }
    let mut mac =
        Hmac::<Sha256>::new_from_slice(&*blinded.local_key).expect("HMAC accepts any key size");
    mac.update(FINISH_DOMAIN);
    mac.update(server_output);
    Ok(hex::encode(mac.finalize().into_bytes()))
}

pub fn finish_password(
    blinded: &Blinded,
    server_output: &[u8],
    options: &PasswordOptions,
) -> Result<String, ProtocolError> {
    let entropy = finish_entropy(blinded, server_output)?;
    Ok(render_password(&entropy, options)?)
}

pub fn decode_hex_input(s: &str) -> Result<[u8; 32], ProtocolError> {
    let decoded = hex::decode(s).map_err(|_| ProtocolError::InvalidHexInput)?;
    decoded
        .try_into()
        .map_err(|_| ProtocolError::InvalidHexInput)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lesspass_core::types::{PasswordOptions, SaltField};

    fn profile() -> PasswordProfile {
        PasswordProfile {
            site: "example.org".into(),
            login: "alice@example.org".into(),
            counter: 1,
            options: PasswordOptions::default(),
            salt_fields: vec![
                SaltField {
                    key: "b".into(),
                    value: "2".into(),
                },
                SaltField {
                    key: "a".into(),
                    value: "1".into(),
                },
            ],
            crypto: None,
        }
    }

    fn crypto() -> CryptoConfig {
        CryptoConfig {
            iterations: 100_000,
            keylen: 8,
            digest: "sha256".into(),
        }
    }

    #[test]
    fn protocol_vector_matches_independent_implementation() {
        let p = profile();
        assert_eq!(
            hex::encode(settings_digest(&p)),
            "21aef735d75b51c62e732e6d38088fcf70ac8bb73adb59d5da04916a0283c417"
        );
        let blinded = blind(&p, "correct horse battery staple", &crypto());
        assert_eq!(
            blinded.input_hex(),
            "a5d9cd6de9e6e665e2dbe35804538aa6382bfcf938c49eb05eb0146c500cac38"
        );
        assert_eq!(
            finish_entropy(&blinded, &[0x42; 32]).unwrap(),
            "cf777b92594f4a7196a95f5cf67a75ea3bd3cc986b575034dfe6dae7e348673e"
        );
    }

    #[test]
    fn settings_digest_and_blinding_are_deterministic_and_order_independent() {
        let p = profile();
        let mut reordered = p.clone();
        reordered.salt_fields.reverse();
        assert_eq!(settings_digest(&p), settings_digest(&reordered));
        assert_eq!(
            blind(&p, "master", &crypto()).input(),
            blind(&p, "master", &crypto()).input()
        );
    }

    #[test]
    fn changes_to_profile_and_crypto_change_the_input() {
        let original = profile();
        let original_input = *blind(&original, "master", &crypto()).input();

        let mut changed = original.clone();
        changed.site.push('x');
        assert_ne!(
            original_input,
            *blind(&changed, "master", &crypto()).input()
        );

        let mut changed = original.clone();
        changed.login.push('x');
        assert_ne!(
            original_input,
            *blind(&changed, "master", &crypto()).input()
        );
        assert_ne!(
            original_input,
            *blind(&original, "different master", &crypto()).input()
        );

        let mut changed = original.clone();
        changed.counter += 1;
        assert_ne!(
            original_input,
            *blind(&changed, "master", &crypto()).input()
        );

        let updates: [fn(&mut PasswordOptions); 4] = [
            |options: &mut PasswordOptions| options.lowercase = false,
            |options: &mut PasswordOptions| options.uppercase = false,
            |options: &mut PasswordOptions| options.digits = false,
            |options: &mut PasswordOptions| options.symbols = false,
        ];
        for update in updates {
            let mut changed = original.clone();
            update(&mut changed.options);
            assert_ne!(
                original_input,
                *blind(&changed, "master", &crypto()).input()
            );
        }

        let mut changed = original.clone();
        changed.options.length += 1;
        assert_ne!(
            original_input,
            *blind(&changed, "master", &crypto()).input()
        );

        let mut changed = original.clone();
        changed.salt_fields[0].value.push('x');
        assert_ne!(
            original_input,
            *blind(&changed, "master", &crypto()).input()
        );

        let mut changed_crypto = crypto();
        changed_crypto.digest = "sha512".into();
        assert_ne!(
            original_input,
            *blind(&original, "master", &changed_crypto).input()
        );
        let mut changed_crypto = crypto();
        changed_crypto.iterations += 1;
        assert_ne!(
            original_input,
            *blind(&original, "master", &changed_crypto).input()
        );
    }

    #[test]
    fn blinded_input_is_not_the_local_key() {
        let blinded = blind(&profile(), "master", &crypto());
        assert_ne!(blinded.input(), &*blinded.local_key);
    }

    #[test]
    fn finish_rejects_short_server_output_and_renders_requested_length() {
        let blinded = blind(&profile(), "master", &crypto());
        assert!(matches!(
            finish_entropy(&blinded, &[0; 31]),
            Err(ProtocolError::ServerOutputTooShort)
        ));
        let options = PasswordOptions {
            length: 16,
            ..PasswordOptions::default()
        };
        assert_eq!(
            finish_password(&blinded, &[0x42; 32], &options)
                .unwrap()
                .len(),
            16
        );
    }

    #[test]
    fn hex_input_accepts_either_case_and_requires_exactly_32_bytes() {
        assert_eq!(decode_hex_input(&"AB".repeat(32)).unwrap(), [0xab; 32]);
        assert!(decode_hex_input(&"00".repeat(31)).is_err());
        assert!(decode_hex_input(&"zz".repeat(32)).is_err());
    }
}
