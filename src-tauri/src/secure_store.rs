use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::{engine::general_purpose, Engine as _};
use once_cell::sync::OnceCell;
use rand::rngs::OsRng;
use rand::RngCore;

const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const ENCRYPTED_PREFIX: &str = "owenc:v1:";
pub const SECRET_SETTING_PRESENT: &str = "__openwiki_secret_present__";

static MASTER_KEY: OnceCell<[u8; KEY_LEN]> = OnceCell::new();

pub fn is_secret_setting(key: &str) -> bool {
    key == "ai_api_key"
        || key.starts_with("ai_api_key_")
        || key == "openai_oauth_token"
        || key == "gemini_oauth_token"
}

pub fn is_encrypted_value(value: &str) -> bool {
    value.starts_with(ENCRYPTED_PREFIX)
}

pub fn is_secret_placeholder(value: &str) -> bool {
    value == SECRET_SETTING_PRESENT
}

pub fn mask_secret_value(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        SECRET_SETTING_PRESENT.to_string()
    }
}

pub fn encrypt_secret(value: &str) -> Result<String, String> {
    let key = master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));

    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);

    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), value.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(format!(
        "{}{}:{}",
        ENCRYPTED_PREFIX,
        general_purpose::STANDARD_NO_PAD.encode(nonce),
        general_purpose::STANDARD_NO_PAD.encode(ciphertext)
    ))
}

pub fn decrypt_secret(value: &str) -> Result<String, String> {
    let encoded = value
        .strip_prefix(ENCRYPTED_PREFIX)
        .ok_or_else(|| "Secret value is not encrypted".to_string())?;
    let (nonce_b64, ciphertext_b64) = encoded
        .split_once(':')
        .ok_or_else(|| "Encrypted secret has invalid format".to_string())?;

    let nonce = general_purpose::STANDARD_NO_PAD
        .decode(nonce_b64)
        .map_err(|e| e.to_string())?;
    if nonce.len() != NONCE_LEN {
        return Err("Encrypted secret nonce has invalid length".to_string());
    }

    let ciphertext = general_purpose::STANDARD_NO_PAD
        .decode(ciphertext_b64)
        .map_err(|e| e.to_string())?;

    let key = master_key()?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let plaintext = cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|e| e.to_string())?;

    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

fn master_key() -> Result<[u8; KEY_LEN], String> {
    MASTER_KEY.get_or_try_init(load_or_create_master_key).copied()
}

#[cfg(test)]
fn load_or_create_master_key() -> Result<[u8; KEY_LEN], String> {
    Ok([7u8; KEY_LEN])
}

#[cfg(not(test))]
fn load_or_create_master_key() -> Result<[u8; KEY_LEN], String> {
    use std::io::{Read, Write};
    use std::path::PathBuf;

    fn key_path() -> Result<PathBuf, String> {
        let base_dir = dirs::data_dir()
            .or_else(|| {
                dirs::home_dir()
                    .map(|home| home.join("Library").join("Application Support"))
            })
            .ok_or_else(|| "Cannot determine application data directory".to_string())?
            .join("com.openwiki.app");
        std::fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;
        Ok(base_dir.join("secure-store.key"))
    }

    fn decode_key(contents: &str) -> Result<[u8; KEY_LEN], String> {
        let bytes = general_purpose::STANDARD
            .decode(contents.trim())
            .map_err(|e| e.to_string())?;
        bytes
            .try_into()
            .map_err(|_| "Stored encryption key has invalid length".to_string())
    }

    let path = key_path()?;
    if path.exists() {
        let mut contents = String::new();
        std::fs::File::open(&path)
            .map_err(|e| e.to_string())?
            .read_to_string(&mut contents)
            .map_err(|e| e.to_string())?;
        return decode_key(&contents);
    }

    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    let encoded = general_purpose::STANDARD.encode(key);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(encoded.as_bytes())
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(unix))]
    {
        std::fs::write(&path, encoded).map_err(|e| e.to_string())?;
    }

    Ok(key)
}

#[cfg(test)]
mod tests {
    use super::{
        decrypt_secret, encrypt_secret, is_encrypted_value, is_secret_placeholder,
        is_secret_setting, mask_secret_value, SECRET_SETTING_PRESENT,
    };

    #[test]
    fn identifies_secret_setting_keys() {
        assert!(is_secret_setting("ai_api_key"));
        assert!(is_secret_setting("ai_api_key_openai"));
        assert!(is_secret_setting("openai_oauth_token"));
        assert!(is_secret_setting("gemini_oauth_token"));
        assert!(!is_secret_setting("ai_provider"));
        assert!(!is_secret_setting("radar_interval_days"));
    }

    #[test]
    fn encrypts_and_decrypts_secret_values() {
        let encrypted = encrypt_secret("sk-test-secret").unwrap();
        assert!(is_encrypted_value(&encrypted));
        assert_ne!(encrypted, "sk-test-secret");
        assert_eq!(decrypt_secret(&encrypted).unwrap(), "sk-test-secret");
    }

    #[test]
    fn masks_non_empty_secret_values_for_bulk_settings() {
        assert_eq!(mask_secret_value("secret"), SECRET_SETTING_PRESENT);
        assert_eq!(mask_secret_value(""), "");
        assert!(is_secret_placeholder(SECRET_SETTING_PRESENT));
    }
}
