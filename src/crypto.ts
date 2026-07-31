export async function deriveKey(seed: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(seed),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode("whatsapp_clone_salt_v1"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(text: string, key: CryptoKey): Promise<string> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(text)
  );

  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join("");
  const encryptedHex = Array.from(new Uint8Array(encrypted)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${ivHex}:${encryptedHex}`;
}

export async function decryptText(encryptedText: string, key: CryptoKey): Promise<string> {
  const [ivHex, dataHex] = encryptedText.split(":");
  if (!ivHex || !dataHex) return "Error decrypting";

  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const data = new Uint8Array(dataHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
  } catch (err) {
    return "Error decrypting";
  }
}

export async function encryptFile(buffer: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    buffer
  );

  // Prepend IV to the encrypted data
  const result = new Uint8Array(iv.length + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), iv.length);
  return result.buffer;
}

export async function decryptFile(encryptedBuffer: ArrayBuffer, key: CryptoKey): Promise<ArrayBuffer> {
  const data = new Uint8Array(encryptedBuffer);
  const iv = data.slice(0, 12);
  const encrypted = data.slice(12);
  
  return await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted
  );
}

export async function hashSeed(seed: string): Promise<string> {
  const enc = new TextEncoder();
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", enc.encode(seed));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
