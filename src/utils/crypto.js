import forge from 'node-forge';

function chunkString(input, size) {
  const chunks = [];
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.substring(i, i + size));
  }
  return chunks;
}

function u8ToBinary(u8) {
  let result = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < u8.length; i += chunkSize) {
    const chunk = u8.subarray(i, i + chunkSize);
    result += String.fromCharCode.apply(null, chunk);
  }
  return result;
}

function binaryToU8(bin) {
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    u8[i] = bin.charCodeAt(i) & 0xff;
  }
  return u8;
}

export function encryptText(publicKeyPem, plaintext) {
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
  const chunks = chunkString(plaintext, 190); // mirrors backend chunking by characters
  const encryptedChunks = chunks.map((chunk) => {
    const encryptedBytes = publicKey.encrypt(chunk, 'RSA-OAEP', {
      md: forge.md.sha1.create(),
      mgf1: forge.mgf1.create(),
    });
    return forge.util.encode64(encryptedBytes);
  });
  return encryptedChunks.join('||');
}

export function decryptText(privateKeyPem, ciphertext) {
  if (!ciphertext) return '';
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const chunks = ciphertext.split('||').filter(Boolean);
  const decrypted = chunks.map((chunkB64) => {
    const encryptedBytes = forge.util.decode64(chunkB64);
    const decryptedChunk = privateKey.decrypt(encryptedBytes, 'RSA-OAEP', {
      md: forge.md.sha1.create(),
      mgf1: forge.mgf1.create(),
    });
    return decryptedChunk;
  });
  return decrypted.join('');
}

export function encryptAudio(publicKeyPem, audioBytes) {
  // audioBytes: Uint8Array
  const publicKey = forge.pki.publicKeyFromPem(publicKeyPem);

  // Random AES key (32 bytes) and IV (16 bytes)
  const aesKeyBytes = forge.random.getBytesSync(32);
  const ivBytes = forge.random.getBytesSync(16);

  // Zero padding to block size 16 (always add at least one full block)
  const block = 16;
  const padLen = block - (audioBytes.length % block) || block;
  const padded = new Uint8Array(audioBytes.length + padLen);
  padded.set(audioBytes, 0);
  // remaining bytes are already zero initialized

  const paddedBin = u8ToBinary(padded);
  const cipher = forge.cipher.createCipher('AES-CBC', aesKeyBytes);
  cipher.start({ iv: ivBytes });
  cipher.update(forge.util.createBuffer(paddedBin));
  cipher.finish();
  const encryptedAudioBin = cipher.output.getBytes();

  // RSA-OAEP encrypt AES key
  const encryptedAesKeyBin = publicKey.encrypt(aesKeyBytes, 'RSA-OAEP', {
    md: forge.md.sha1.create(),
    mgf1: forge.mgf1.create(),
  });

  return {
    encrypted_audio: forge.util.encode64(encryptedAudioBin),
    encrypted_aes_key: forge.util.encode64(encryptedAesKeyBin),
    iv: forge.util.encode64(ivBytes),
  };
}

export function decryptAudio(privateKeyPem, encryptedAudioB64, encryptedAesKeyB64, ivB64) {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const encryptedAudioBin = forge.util.decode64(encryptedAudioB64);
  const encryptedAesKeyBin = forge.util.decode64(encryptedAesKeyB64);
  const ivBin = forge.util.decode64(ivB64);

  const aesKeyBytes = privateKey.decrypt(encryptedAesKeyBin, 'RSA-OAEP', {
    md: forge.md.sha1.create(),
    mgf1: forge.mgf1.create(),
  });

  const decipher = forge.cipher.createDecipher('AES-CBC', aesKeyBytes);
  decipher.start({ iv: ivBin });
  decipher.update(forge.util.createBuffer(encryptedAudioBin));
  const ok = decipher.finish();
  if (!ok) throw new Error('AES decryption failed');
  const decryptedBin = decipher.output.getBytes();

  // Strip zero padding
  let end = decryptedBin.length;
  while (end > 0 && decryptedBin.charCodeAt(end - 1) === 0) {
    end--;
  }
  const trimmed = decryptedBin.substring(0, end);
  return binaryToU8(trimmed);
} 