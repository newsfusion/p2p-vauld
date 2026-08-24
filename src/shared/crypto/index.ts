/**
 * Web Crypto API wrappers — AES-GCM 256-bit encryption + PBKDF2 key derivation.
 * No third-party libraries. Works in both service workers and browser contexts.
 */

const PBKDF2_ITERATIONS = 310_000;
const AES_KEY_BITS = 256;
const IV_BYTES = 12;

// ─── Base64 helpers ───────────────────────────────────────────────────────────

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) ?? 0;
  }
  return bytes.buffer;
}

// ─── Key generation ───────────────────────────────────────────────────────────

/**
 * Derives a 256-bit AES-GCM key from a master password + salt via PBKDF2.
 * The master password itself is never stored — only this derived key (or a
 * verification hash) is kept in memory during the session.
 */
export async function deriveKeyFromPassword(
  masterPassword: string,
  saltBase64: string
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const salt = base64ToBuffer(saltBase64);
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generates a random 256-bit AES-GCM key (for "invisible key" mode — no master password).
 */
export async function generateRandomKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Exports a CryptoKey to a base64-encoded raw string for storage.
 * Only used for the "invisible key" (no master password). Never export a key derived from a master password.
 */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

/**
 * Imports a base64-encoded raw key back into a CryptoKey.
 */
export async function importKeyFromBase64(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBuffer(keyBase64);
  return crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM', length: AES_KEY_BITS },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generates a cryptographically random salt (16 bytes), returned as base64.
 */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return bufferToBase64(salt.buffer);
}

// ─── Encryption / Decryption ──────────────────────────────────────────────────

type CredentialField = "username" | "password";

export interface EncryptedBlob {
  iv: string;         // Base64-encoded 12-byte IV
  ciphertext: string; // Base64-encoded AES-GCM ciphertext (with auth tag)
}

export function credentialAad(
  platformId: string,
  field: CredentialField,
): string {
  return `p2p-cred:${platformId}:${field}`;
}

/**
 * Encrypts plaintext with AES-GCM 256-bit.
 * A fresh random IV is generated for each encryption.
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: string,
  aad?: string,
): Promise<EncryptedBlob> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      ...(aad === undefined ? {} : { additionalData: enc.encode(aad) }),
    },
    key,
    enc.encode(plaintext)
  );
  return {
    iv: bufferToBase64(iv.buffer),
    ciphertext: bufferToBase64(ciphertext),
  };
}

/**
 * Decrypts an AES-GCM ciphertext blob.
 * Throws if authentication fails (tampered data).
 */
export async function decrypt(
  key: CryptoKey,
  blob: EncryptedBlob,
  aad?: string,
): Promise<string> {
  const iv = base64ToBuffer(blob.iv);
  const ciphertext = base64ToBuffer(blob.ciphertext);
  const enc = new TextEncoder();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv,
      ...(aad === undefined ? {} : { additionalData: enc.encode(aad) }),
    },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

// ─── Password verification ────────────────────────────────────────────────────

/**
 * Derives a verification token from the master password.
 * Stored to allow verifying the password on future unlocks without storing the password itself.
 * Uses a different salt from the encryption key derivation.
 */
export async function deriveVerificationHash(
  masterPassword: string,
  verifySaltBase64: string
): Promise<string> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(masterPassword),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const salt = base64ToBuffer(verifySaltBase64);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bufferToBase64(bits);
}
