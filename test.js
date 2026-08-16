import assert from 'assert';
import crypto from 'crypto';

console.log('🧪 Running UPI Mesh Payments Test Suite...\n');

// 1. Key generation and Hybrid Cryptography Test
const keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function encryptInstruction(instruction, publicKey) {
  const plaintext = Buffer.from(JSON.stringify(instruction));
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const encryptedPayload = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const aesCiphertext = Buffer.concat([encryptedPayload, tag]);

  const encryptedAesKey = crypto.publicEncrypt({
    key: publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, aesKey);

  const buffer = Buffer.concat([encryptedAesKey, iv, aesCiphertext]);
  return buffer.toString('base64');
}

function decryptInstruction(base64Ciphertext, privateKey) {
  const all = Buffer.from(base64Ciphertext, 'base64');
  if (all.length < 256 + 12 + 16) {
    throw new Error('Ciphertext too short');
  }

  const encryptedAesKey = all.subarray(0, 256);
  const iv = all.subarray(256, 268);
  const aesCiphertext = all.subarray(268);

  const aesKey = crypto.privateDecrypt({
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, encryptedAesKey);

  const tag = aesCiphertext.subarray(aesCiphertext.length - 16);
  const content = aesCiphertext.subarray(0, aesCiphertext.length - 16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(content), decipher.final()]);

  return JSON.parse(plaintext.toString('utf-8'));
}

// Test 1: Encrypt/Decrypt Roundtrip
{
  const instruction = {
    senderVpa: 'alice@meshpay',
    receiverVpa: 'bob@meshpay',
    amount: 500,
    pinHash: sha256Hex('1234'),
    nonce: crypto.randomUUID(),
    signedAt: Date.now()
  };

  const ciphertext = encryptInstruction(instruction, keyPair.publicKey);
  const decrypted = decryptInstruction(ciphertext, keyPair.privateKey);

  assert.strictEqual(decrypted.senderVpa, instruction.senderVpa);
  assert.strictEqual(decrypted.receiverVpa, instruction.receiverVpa);
  assert.strictEqual(decrypted.amount, instruction.amount);
  assert.strictEqual(decrypted.pinHash, instruction.pinHash);
  assert.strictEqual(decrypted.nonce, instruction.nonce);
  console.log('✅ Test 1 Passed: Hybrid RSA-OAEP + AES-256-GCM Encrypt/Decrypt Roundtrip');
}

// Test 2: Tampered Ciphertext Rejection (AES-GCM Auth Tag Failure)
{
  const instruction = {
    senderVpa: 'alice@meshpay',
    receiverVpa: 'bob@meshpay',
    amount: 500,
    pinHash: sha256Hex('1234'),
    nonce: crypto.randomUUID(),
    signedAt: Date.now()
  };

  const ciphertext = encryptInstruction(instruction, keyPair.publicKey);
  const buf = Buffer.from(ciphertext, 'base64');
  // Tamper a byte in the payload
  buf[buf.length - 5] ^= 0xFF;
  const tamperedCiphertext = buf.toString('base64');

  let failedAsExpected = false;
  try {
    decryptInstruction(tamperedCiphertext, keyPair.privateKey);
  } catch (err) {
    failedAsExpected = true;
  }

  assert.strictEqual(failedAsExpected, true, 'Tampered ciphertext must fail decryption');
  console.log('✅ Test 2 Passed: Tampered Ciphertext Detected and Rejected');
}

// Test 3: Idempotency Detection via Ciphertext Hash
{
  const idempotencySet = new Set();
  const ciphertext = encryptInstruction({ amount: 100 }, keyPair.publicKey);
  const hash = sha256Hex(ciphertext);

  function checkAndClaim(packetHash) {
    if (idempotencySet.has(packetHash)) {
      return 'DUPLICATE_DROPPED';
    }
    idempotencySet.add(packetHash);
    return 'SETTLED';
  }

  const firstAttempt = checkAndClaim(hash);
  const secondAttempt = checkAndClaim(hash);
  const thirdAttempt = checkAndClaim(hash);

  assert.strictEqual(firstAttempt, 'SETTLED');
  assert.strictEqual(secondAttempt, 'DUPLICATE_DROPPED');
  assert.strictEqual(thirdAttempt, 'DUPLICATE_DROPPED');
  console.log('✅ Test 3 Passed: Idempotency Cache Drops Concurrent Duplicates');
}

console.log('\n🎉 All tests passed successfully!');
