import { describe, it, expect } from 'vitest';
import {
  generateRandomKey,
  exportKeyToBase64,
  importKeyFromBase64,
  credentialAad,
  encrypt,
  decrypt,
  generateSalt,
  deriveKeyFromPassword,
  deriveVerificationHash,
} from '../../src/shared/crypto/index.js';

describe('Crypto — AES-GCM round-trip', () => {
  it('encrypts and decrypts plaintext correctly', async () => {
    const key = await generateRandomKey();
    const plaintext = 'my-secret-password-123!@#';
    const blob = await encrypt(key, plaintext);

    expect(blob.iv).toBeTruthy();
    expect(blob.ciphertext).toBeTruthy();
    expect(blob.ciphertext).not.toContain(plaintext);

    const decrypted = await decrypt(key, blob);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (unique IVs)', async () => {
    const key = await generateRandomKey();
    const plaintext = 'same-input';
    const blob1 = await encrypt(key, plaintext);
    const blob2 = await encrypt(key, plaintext);

    expect(blob1.iv).not.toBe(blob2.iv);
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext);
  });

  it('fails to decrypt with a wrong key', async () => {
    const key1 = await generateRandomKey();
    const key2 = await generateRandomKey();
    const blob = await encrypt(key1, 'secret');

    await expect(decrypt(key2, blob)).rejects.toThrow();
  });

  it('fails to decrypt tampered ciphertext', async () => {
    const key = await generateRandomKey();
    const blob = await encrypt(key, 'secret');
    const tampered = { ...blob, ciphertext: blob.ciphertext.slice(0, -4) + 'AAAA' };

    await expect(decrypt(key, tampered)).rejects.toThrow();
  });

  it('binds ciphertext to AES-GCM additional authenticated data', async () => {
    const key = await generateRandomKey();
    const aad = credentialAad("mintos", "password");
    const blob = await encrypt(key, "secret", aad);

    await expect(decrypt(key, blob, aad)).resolves.toBe("secret");
    await expect(
      decrypt(key, blob, credentialAad("debitum", "password")),
    ).rejects.toThrow();
    await expect(
      decrypt(key, blob, credentialAad("mintos", "username")),
    ).rejects.toThrow();
  });
});

describe('Crypto — Key export/import', () => {
  it('exports and imports a key preserving encrypt/decrypt capability', async () => {
    const key = await generateRandomKey();
    const keyBase64 = await exportKeyToBase64(key);
    const restored = await importKeyFromBase64(keyBase64);

    const plaintext = 'round-trip-test';
    const blob = await encrypt(key, plaintext);
    const decrypted = await decrypt(restored, blob);
    expect(decrypted).toBe(plaintext);
  });

  it('imports keys as extractable by default so they can be persisted again', async () => {
    const key = await generateRandomKey();
    const keyBase64 = await exportKeyToBase64(key);
    const restored = await importKeyFromBase64(keyBase64);

    await expect(exportKeyToBase64(restored)).resolves.toBe(keyBase64);
  });
});

describe('Crypto — PBKDF2 key derivation', () => {
  it('derives the same key from the same password + salt', async () => {
    const password = 'hunter2';
    const salt = generateSalt();

    const key1 = await deriveKeyFromPassword(password, salt);
    const key2 = await deriveKeyFromPassword(password, salt);

    // Encrypt with key1, decrypt with key2
    const blob = await encrypt(key1, 'test-value');
    const decrypted = await decrypt(key2, blob);
    expect(decrypted).toBe('test-value');
  });

  it('derives different keys for different passwords', async () => {
    const salt = generateSalt();
    const key1 = await deriveKeyFromPassword('password-A', salt);
    const key2 = await deriveKeyFromPassword('password-B', salt);

    const blob = await encrypt(key1, 'secret');
    await expect(decrypt(key2, blob)).rejects.toThrow();
  });

  it('derives different keys for different salts', async () => {
    const password = 'same-password';
    const key1 = await deriveKeyFromPassword(password, generateSalt());
    const key2 = await deriveKeyFromPassword(password, generateSalt());

    const blob = await encrypt(key1, 'secret');
    await expect(decrypt(key2, blob)).rejects.toThrow();
  });
});

describe('Crypto — Verification hash', () => {
  it('produces the same hash for the same password + salt', async () => {
    const password = 'my-master-password';
    const verifySalt = generateSalt();
    const hash1 = await deriveVerificationHash(password, verifySalt);
    const hash2 = await deriveVerificationHash(password, verifySalt);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different passwords', async () => {
    const verifySalt = generateSalt();
    const hash1 = await deriveVerificationHash('pass-A', verifySalt);
    const hash2 = await deriveVerificationHash('pass-B', verifySalt);
    expect(hash1).not.toBe(hash2);
  });
});
