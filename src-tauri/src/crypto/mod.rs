//! Master-password based encryption for the app's single data file (ADR-0005).
//! Argon2id derives the key from the password; AES-256-GCM encrypts the blob.
//! Pure-Rust crates only (argon2, aes-gcm) — no C/OpenSSL linking (NFR-6, CON-2).

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;
use thiserror::Error;

pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("failed to derive encryption key from password")]
    KeyDerivation,
    #[error("failed to encrypt data")]
    Encryption,
    #[error("failed to decrypt data — wrong password or corrupted file")]
    Decryption,
}

/// Derives a 256-bit key from a master password and salt using Argon2id.
/// Deterministic: the same password + salt always yields the same key.
pub fn derive_key(password: &str, salt: &[u8; SALT_LEN]) -> Result<[u8; KEY_LEN], CryptoError> {
    let mut key = [0u8; KEY_LEN];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| CryptoError::KeyDerivation)?;
    Ok(key)
}

/// Generates a fresh random salt for a new data file.
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Encrypts `plaintext` with `key`, returning a freshly generated nonce and the ciphertext.
/// A new random nonce is generated on every call — nonces must never repeat for a given key.
pub fn encrypt(key: &[u8; KEY_LEN], plaintext: &[u8]) -> Result<(Vec<u8>, Vec<u8>), CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::Encryption)?;
    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|_| CryptoError::Encryption)?;
    Ok((nonce_bytes.to_vec(), ciphertext))
}

/// Decrypts `ciphertext` with `key` and `nonce`. Fails if the key is wrong or the data
/// was tampered with — AES-GCM's authentication tag makes both cases indistinguishable
/// from each other, which is intentional (no oracle for guessing the password).
pub fn decrypt(key: &[u8; KEY_LEN], nonce: &[u8], ciphertext: &[u8]) -> Result<Vec<u8>, CryptoError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CryptoError::Decryption)?;
    let nonce = Nonce::from_slice(nonce);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::Decryption)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_key_is_deterministic_for_same_password_and_salt() {
        let salt = generate_salt();
        let k1 = derive_key("hunter2", &salt).unwrap();
        let k2 = derive_key("hunter2", &salt).unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn derive_key_differs_for_different_passwords() {
        let salt = generate_salt();
        let k1 = derive_key("hunter2", &salt).unwrap();
        let k2 = derive_key("hunter3", &salt).unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn derive_key_differs_for_different_salts() {
        let salt_a = generate_salt();
        let salt_b = generate_salt();
        let k1 = derive_key("hunter2", &salt_a).unwrap();
        let k2 = derive_key("hunter2", &salt_b).unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn encrypt_decrypt_roundtrip() {
        let salt = generate_salt();
        let key = derive_key("hunter2", &salt).unwrap();
        let plaintext = b"top secret project notes";
        let (nonce, ciphertext) = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &nonce, &ciphertext).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_produces_different_ciphertext_each_call() {
        let salt = generate_salt();
        let key = derive_key("hunter2", &salt).unwrap();
        let (_, ct1) = encrypt(&key, b"same plaintext").unwrap();
        let (_, ct2) = encrypt(&key, b"same plaintext").unwrap();
        assert_ne!(ct1, ct2, "nonce reuse would make ciphertexts identical");
    }

    #[test]
    fn decrypt_fails_with_wrong_key() {
        let salt = generate_salt();
        let key = derive_key("hunter2", &salt).unwrap();
        let wrong_key = derive_key("wrong-password", &salt).unwrap();
        let (nonce, ciphertext) = encrypt(&key, b"data").unwrap();
        assert!(decrypt(&wrong_key, &nonce, &ciphertext).is_err());
    }

    #[test]
    fn decrypt_fails_on_tampered_ciphertext() {
        let salt = generate_salt();
        let key = derive_key("hunter2", &salt).unwrap();
        let (nonce, mut ciphertext) = encrypt(&key, b"data").unwrap();
        ciphertext[0] ^= 0xFF;
        assert!(decrypt(&key, &nonce, &ciphertext).is_err());
    }
}
