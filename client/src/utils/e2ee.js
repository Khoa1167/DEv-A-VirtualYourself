/**
 * Web Crypto API End-to-End Encryption (E2EE) Module
 * Chạy hoàn toàn trên Browser Client (Zero-Knowledge Server Architecture)
 */

const DB_NAME = 'ChatAppE2EE';
const DB_VERSION = 1;
const STORE_NAME = 'privateKeys';

// ─── 1. Quản lý IndexedDB cho Private Keys (non-extractable) ─────────────────
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

export const storePrivateKey = async (deviceId, privateKey) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(privateKey, deviceId);
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getPrivateKey = async (deviceId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(deviceId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
};

export const storePublicKey = async (deviceId, publicKey) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(publicKey, `public_${deviceId}`);
    req.onsuccess = () => resolve(true);
    req.onerror = (e) => reject(e.target.error);
  });
};

export const getPublicKey = async (deviceId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(`public_${deviceId}`);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = (e) => reject(e.target.error);
  });
};

// ─── 2. Quản lý Device ID ──────────────────────────────────────────────────
export const getDeviceId = () => {
  let deviceId = localStorage.getItem('chat_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Array.from(window.crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('chat_device_id', deviceId);
  }
  return deviceId;
};

// ─── 3. Sinh Cặp khóa RSA-OAEP 2048-bit ────────────────────────────────────
export const generateKeyPair = async () => {
  return await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true, // privateKey extractable để backup/recovery
    ['encrypt', 'decrypt']
  );
};

export const exportPublicKey = async (publicKey) => {
  const exported = await window.crypto.subtle.exportKey('jwk', publicKey);
  return JSON.stringify(exported);
};

export const importPublicKey = async (jwkString) => {
  const jwk = typeof jwkString === 'string' ? JSON.parse(jwkString) : jwkString;
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    true,
    ['encrypt']
  );
};

export const exportPublicKeyFromPrivateKey = async (privateKey) => {
  const privateJwk = await window.crypto.subtle.exportKey('jwk', privateKey);
  const publicJwk = {
    kty: privateJwk.kty,
    n: privateJwk.n,
    e: privateJwk.e,
    ext: true
  };
  return JSON.stringify(publicJwk);
};

// ─── 4. Mã hóa & Giải mã Tin nhắn Client-side ──────────────────────────────
/**
 * Mã hóa tin nhắn cho tất cả thiết bị trong phòng chat
 * @param {string} text 
 * @param {Array<{ deviceId: string, publicKey: string }>} devicePublicKeys 
 * @returns {object} { content: string (base64), iv: string (base64), tag: string (base64), encryptedKeys: object }
 */
export const encryptMessageForRoom = async (text, devicePublicKeys) => {
  if (!text) return { content: '', iv: '', tag: '', encryptedKeys: {} };

  // 1. Sinh AES Session Key ngẫu nhiên 256-bit
  const sessionKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encodedText = encoder.encode(text);

  // 2. Mã hóa tin nhắn bằng AES Session Key
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    sessionKey,
    encodedText
  );

  // Buffer chứa cả ciphertext và 16-bytes Auth Tag ở cuối trong Web Crypto API
  const ciphertextArray = new Uint8Array(ciphertextBuffer);
  const tag = ciphertextArray.slice(-16);
  const content = ciphertextArray.slice(0, -16);

  // Export sessionKey dạng raw để mã hóa bằng RSA
  const rawSessionKey = await window.crypto.subtle.exportKey('raw', sessionKey);

  // 3. Mã hóa sessionKey cho từng deviceId
  const encryptedKeys = {};
  for (const dev of devicePublicKeys) {
    try {
      if (!dev.publicKey) continue;
      const pubKey = await importPublicKey(dev.publicKey);
      const encryptedKeyBuf = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        pubKey,
        rawSessionKey
      );
      encryptedKeys[dev.deviceId] = arrayBufferToBase64(encryptedKeyBuf);
    } catch (err) {
      console.warn(`[E2EE] Cannot encrypt key for device ${dev.deviceId}:`, err);
    }
  }

  return {
    content: arrayBufferToBase64(content),
    iv: arrayBufferToBase64(iv),
    tag: arrayBufferToBase64(tag),
    encryptedKeys,
  };
};

/**
 * Giải mã tin nhắn bằng PrivateKey của thiết bị hiện tại
 * @param {object} msg 
 * @param {string} deviceId 
 * @returns {string} Text rõ
 */
export const decryptMessage = async (msg, deviceId) => {
  if (!msg || !msg.content) return '';
  if (!msg.encryptedKeys) return msg.content; // Plaintext legacy fallback

  const encryptedKeyBase64 = msg.encryptedKeys[deviceId] || msg.encryptedKeys.get?.(deviceId);
  if (!encryptedKeyBase64) {
    return '[Không thể giải mã tin nhắn — Thiết bị này chưa được mã hóa khóa]';
  }

  try {
    const privateKey = await getPrivateKey(deviceId);
    if (!privateKey) {
      return '[Không tìm thấy Private Key trên thiết bị này]';
    }

    const encryptedKeyBuf = base64ToArrayBuffer(encryptedKeyBase64);
    const rawSessionKey = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      privateKey,
      encryptedKeyBuf
    );

    const sessionKey = await window.crypto.subtle.importKey(
      'raw',
      rawSessionKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const contentBuf = base64ToArrayBuffer(msg.content);
    const tagBuf = base64ToArrayBuffer(msg.tag);
    const ivBuf = base64ToArrayBuffer(msg.iv);

    // Gộp content + tag theo định dạng mã hóa Web Crypto API
    const combinedBuf = new Uint8Array(contentBuf.byteLength + tagBuf.byteLength);
    combinedBuf.set(new Uint8Array(contentBuf), 0);
    combinedBuf.set(new Uint8Array(tagBuf), contentBuf.byteLength);

    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBuf },
      sessionKey,
      combinedBuf
    );

    const decoder = new TextDecoder();
    return decoder.decode(decryptedBuffer);
  } catch (err) {
    console.error('[E2EE] Decryption error:', err);
    return '[Lỗi Giải Mã Tin Nhắn]';
  }
};

// ─── 5. Safety Number (Key Fingerprint) ────────────────────────────────────
export const computeFingerprint = async (publicKeyJWK) => {
  if (!publicKeyJWK) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(typeof publicKeyJWK === 'string' ? publicKeyJWK : JSON.stringify(publicKeyJWK));
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  
  // Format thành 12 nhóm x 5 chữ số
  const digits = hashArray.map(b => b.toString().padStart(3, '0')).join('');
  const formatted = [];
  for (let i = 0; i < 60; i += 5) {
    formatted.push(digits.substring(i, i + 5));
  }
  return formatted.join(' ');
};

// ─── 6. Passphrase Backup & Recovery (PBKDF2 600k iterations) ───────────────
export const exportPrivateKeyEncrypted = async (privateKey, publicKeyJWK, passphrase) => {
  if (!passphrase || passphrase.length < 12) {
    throw new Error('Passphrase phải có độ dài tối thiểu 12 ký tự.');
  }

  // 1. Export privateKey sang PKCS8
  const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', privateKey);

  // 2. Derive encryption key từ passphrase sử dụng PBKDF2 600,000 iterations
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const passphraseKey = await window.crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );

  const derivedKey = await window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 600000,
      hash: 'SHA-256'
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    exportedPrivateKey
  );

  const backupData = {
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
    data: arrayBufferToBase64(encryptedPrivateKey),
    publicKey: publicKeyJWK || null,
  };

  return btoa(JSON.stringify(backupData));
};

export const importPrivateKeyFromBackup = async (backupString, passphrase) => {
  try {
    const backupData = JSON.parse(atob(backupString));
    const salt = base64ToArrayBuffer(backupData.salt);
    const iv = base64ToArrayBuffer(backupData.iv);
    const encryptedData = base64ToArrayBuffer(backupData.data);

    const enc = new TextEncoder();
    const passphraseKey = await window.crypto.subtle.importKey(
      'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
    );

    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 600000,
        hash: 'SHA-256'
      },
      passphraseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    const decryptedPKCS8 = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      derivedKey,
      encryptedData
    );

    const privateKey = await window.crypto.subtle.importKey(
      'pkcs8',
      decryptedPKCS8,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    );

    return {
      privateKey,
      publicKey: backupData.publicKey || null,
    };
  } catch {
    throw new Error('Mật khẩu giải mã hoặc tệp sao lưu không chính xác.');
  }
};

// Helpers Base64 <-> ArrayBuffer
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
