import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(__dirname));

// --- RSA Keypair Generation ---
const keyPair = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048
});
const publicKeyDer = keyPair.publicKey.export({ type: 'spki', format: 'der' });
const publicKeyBase64 = publicKeyDer.toString('base64');

// --- Helper Utilities ---
function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function findWallet(identifier) {
  if (!identifier) return null;
  if (wallets.has(identifier)) return wallets.get(identifier);

  // Check phone
  if (users.has(identifier)) {
    const user = users.get(identifier);
    if (wallets.has(user.upiId)) return wallets.get(user.upiId);
  }

  // Check case-insensitive UPI ID or phone
  const idLower = String(identifier).toLowerCase();
  for (const [upi, wallet] of wallets.entries()) {
    if (upi.toLowerCase() === idLower) return wallet;
  }
  for (const user of users.values()) {
    if (user.upiId.toLowerCase() === idLower || user.phone === identifier) {
      if (wallets.has(user.upiId)) return wallets.get(user.upiId);
    }
  }
  return null;
}

function encryptInstruction(instruction) {
  const plaintext = Buffer.from(JSON.stringify(instruction));
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const encryptedPayload = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const aesCiphertext = Buffer.concat([encryptedPayload, tag]);

  const encryptedAesKey = crypto.publicEncrypt({
    key: keyPair.publicKey,
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256'
  }, aesKey);

  const buffer = Buffer.concat([encryptedAesKey, iv, aesCiphertext]);
  return buffer.toString('base64');
}

function decryptInstruction(base64Ciphertext) {
  const all = Buffer.from(base64Ciphertext, 'base64');
  if (all.length < 256 + 12 + 16) {
    throw new Error('Ciphertext too short');
  }

  const encryptedAesKey = all.subarray(0, 256);
  const iv = all.subarray(256, 268);
  const aesCiphertext = all.subarray(268);

  const aesKey = crypto.privateDecrypt({
    key: keyPair.privateKey,
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

// --- In-Memory Database ---
let userIdCounter = 1;
let txIdCounter = 1;

const users = new Map(); // phone -> User
const wallets = new Map(); // upiId -> Wallet
const transactions = []; // List of Transactions
const idempotencySet = new Set(); // Packet hashes

// Virtual devices for Mesh Simulation
const devices = new Map([
  ['phone-alice', { deviceId: 'phone-alice', hasInternet: false, heldPackets: [] }],
  ['phone-stranger1', { deviceId: 'phone-stranger1', hasInternet: false, heldPackets: [] }],
  ['phone-stranger2', { deviceId: 'phone-stranger2', hasInternet: false, heldPackets: [] }],
  ['phone-stranger3', { deviceId: 'phone-stranger3', hasInternet: false, heldPackets: [] }],
  ['phone-bridge', { deviceId: 'phone-bridge', hasInternet: true, heldPackets: [] }]
]);

// --- Seed Demo Users and Wallets ---
function seedUser(name, phone, upiId, balance) {
  const id = String(userIdCounter++);
  const user = { id, name, phone, upiId, createdAt: Date.now() };
  users.set(phone, user);

  const wallet = {
    upiId,
    userId: id,
    bankName: 'Demo Bank',
    mpinHash: sha256Hex('1234'),
    balance: Number(balance)
  };
  wallets.set(upiId, wallet);
}

seedUser('Alice', '9000000001', 'alice@meshpay', '5000.00');
seedUser('Bob', '9000000002', 'bob@meshpay', '1000.00');
seedUser('Carol', '9000000003', 'carol@meshpay', '2500.00');
seedUser('Dave', '9000000004', 'dave@meshpay', '500.00');

console.log('Seeded 4 demo users and wallets');

// --- Routes ---

// Serve Dashboard as Root Page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// Server Key
app.get('/api/server-key', (req, res) => {
  res.json({
    publicKey: publicKeyBase64,
    algorithm: 'RSA-2048 / OAEP-SHA256',
    hybridScheme: 'RSA-OAEP encrypts an AES-256-GCM session key'
  });
});

// Demo Send (inject packet into mesh)
app.post('/api/demo/send', (req, res) => {
  try {
    const { senderVpa, receiverVpa, amount, pin, ttl, startDevice } = req.body;
    const instruction = {
      senderVpa,
      receiverVpa,
      amount: Number(amount),
      pinHash: sha256Hex(pin),
      nonce: crypto.randomUUID(),
      signedAt: Date.now()
    };

    const ciphertext = encryptInstruction(instruction);
    const packet = {
      packetId: crypto.randomUUID(),
      ttl: ttl || 5,
      createdAt: Date.now(),
      ciphertext
    };

    const deviceId = startDevice || 'phone-alice';
    const targetDevice = devices.get(deviceId);
    if (!targetDevice) {
      return res.status(400).json({ error: `Unknown device: ${deviceId}` });
    }

    targetDevice.heldPackets.push(packet);

    res.json({
      packetId: packet.packetId,
      ciphertextPreview: ciphertext.substring(0, 64) + '...',
      ttl: packet.ttl,
      injectedAt: deviceId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mesh Simulator State
app.get('/api/mesh/state', (req, res) => {
  const deviceList = Array.from(devices.values()).map(d => ({
    deviceId: d.deviceId,
    hasInternet: d.hasInternet,
    packetCount: d.heldPackets.length,
    packetIds: d.heldPackets.map(p => p.packetId.substring(0, 8))
  }));

  res.json({
    devices: deviceList,
    idempotencyCacheSize: idempotencySet.size
  });
});

// Mesh Gossip
app.post('/api/mesh/gossip', (req, res) => {
  let transfers = 0;
  const deviceList = Array.from(devices.values());
  const snapshot = new Map();

  for (const d of deviceList) {
    snapshot.set(d.deviceId, [...d.heldPackets]);
  }

  for (const src of deviceList) {
    const srcPackets = snapshot.get(src.deviceId) || [];
    for (const pkt of srcPackets) {
      if (pkt.ttl <= 0) continue;
      for (const dst of deviceList) {
        if (dst.deviceId === src.deviceId) continue;
        if (dst.heldPackets.some(p => p.packetId === pkt.packetId)) continue;

        const copy = { ...pkt, ttl: pkt.ttl - 1 };
        dst.heldPackets.push(copy);
        transfers++;
      }
    }
  }

  const deviceCounts = {};
  for (const d of devices.values()) {
    deviceCounts[d.deviceId] = d.heldPackets.length;
  }

  res.json({
    transfers,
    deviceCounts
  });
});

// Ingest Logic Helper
function ingestPacket(packet, bridgeNodeId, hopCount) {
  try {
    const packetHash = sha256Hex(packet.ciphertext);

    // Idempotency Gate
    if (idempotencySet.has(packetHash)) {
      return {
        outcome: 'DUPLICATE_DROPPED',
        packetHash,
        reason: null,
        transactionId: null
      };
    }
    idempotencySet.add(packetHash);

    // Decrypt
    let instruction;
    try {
      instruction = decryptInstruction(packet.ciphertext);
    } catch (e) {
      return {
        outcome: 'INVALID',
        packetHash,
        reason: 'decryption_failed',
        transactionId: null
      };
    }

    // Freshness Check
    const ageSeconds = (Date.now() - instruction.signedAt) / 1000;
    if (ageSeconds > 86400) {
      return { outcome: 'INVALID', packetHash, reason: 'stale_packet', transactionId: null };
    }
    if (ageSeconds < -300) {
      return { outcome: 'INVALID', packetHash, reason: 'future_dated', transactionId: null };
    }

    // Settle
    const sender = findWallet(instruction.senderVpa);
    const receiver = findWallet(instruction.receiverVpa);

    if (!sender || !receiver) {
      return { outcome: 'INVALID', packetHash, reason: 'wallet_not_found', transactionId: null };
    }

    const amount = Number(instruction.amount);
    if (amount <= 0) {
      return { outcome: 'INVALID', packetHash, reason: 'invalid_amount', transactionId: null };
    }

    if (sender.mpinHash !== instruction.pinHash) {
      const tx = recordTransaction({
        packetHash,
        senderVpa: instruction.senderVpa,
        receiverVpa: instruction.receiverVpa,
        amount,
        signedAt: instruction.signedAt,
        settledAt: Date.now(),
        bridgeNodeId,
        hopCount,
        status: 'REJECTED',
        type: 'MESH'
      });
      return { outcome: 'SETTLED', packetHash, reason: 'invalid_mpin', transactionId: tx.id };
    }

    if (sender.balance < amount) {
      const tx = recordTransaction({
        packetHash,
        senderVpa: instruction.senderVpa,
        receiverVpa: instruction.receiverVpa,
        amount,
        signedAt: instruction.signedAt,
        settledAt: Date.now(),
        bridgeNodeId,
        hopCount,
        status: 'REJECTED',
        type: 'MESH'
      });
      return { outcome: 'SETTLED', packetHash, reason: 'insufficient_balance', transactionId: tx.id };
    }

    // Process Ledger Transfer
    sender.balance -= amount;
    receiver.balance += amount;

    const tx = recordTransaction({
      packetHash,
      senderVpa: instruction.senderVpa,
      receiverVpa: instruction.receiverVpa,
      amount,
      signedAt: instruction.signedAt,
      settledAt: Date.now(),
      bridgeNodeId,
      hopCount,
      status: 'SETTLED',
      type: 'MESH'
    });

    return { outcome: 'SETTLED', packetHash, reason: null, transactionId: tx.id };

  } catch (err) {
    return { outcome: 'INVALID', packetHash: '?', reason: 'internal_error: ' + err.message, transactionId: null };
  }
}

function recordTransaction(data) {
  const tx = {
    id: txIdCounter++,
    transactionId: crypto.randomUUID(),
    ...data
  };
  transactions.unshift(tx);
  return tx;
}

// Mesh Flush
app.post('/api/mesh/flush', (req, res) => {
  const uploads = [];
  for (const d of devices.values()) {
    if (!d.hasInternet) continue;
    for (const pkt of d.heldPackets) {
      uploads.push({ bridgeNodeId: d.deviceId, packet: pkt });
    }
  }

  const results = uploads.map(up => {
    const r = ingestPacket(up.packet, up.bridgeNodeId, 5 - up.packet.ttl);
    return {
      bridgeNode: up.bridgeNodeId,
      packetId: up.packet.packetId.substring(0, 8),
      outcome: r.outcome,
      reason: r.reason || '',
      transactionId: r.transactionId !== null ? r.transactionId : -1
    };
  });

  res.json({
    uploadsAttempted: uploads.length,
    results
  });
});

// Mesh Reset
app.post('/api/mesh/reset', (req, res) => {
  for (const d of devices.values()) {
    d.heldPackets = [];
  }
  idempotencySet.clear();
  res.json({ status: 'mesh and idempotency cache cleared' });
});

// Bridge Ingest Endpoint
app.post('/api/bridge/ingest', (req, res) => {
  const packet = req.body;
  const bridgeNodeId = req.headers['x-bridge-node-id'] || 'unknown';
  const hopCount = parseInt(req.headers['x-hop-count'] || '0', 10);

  const result = ingestPacket(packet, bridgeNodeId, hopCount);
  res.json(result);
});

// Auth Routes
app.post('/api/v1/auth/signup', (req, res) => {
  const { name, phone, mpin } = req.body;
  if (!name || !phone || !mpin) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  if (users.has(phone)) {
    return res.status(400).json({ error: 'Phone number already registered.' });
  }

  const upiId = phone.includes('@') ? phone : phone + '@swiftpay';
  const id = String(userIdCounter++);
  const user = { id, name, phone, upiId, createdAt: Date.now() };
  users.set(phone, user);

  const wallet = {
    upiId,
    userId: id,
    bankName: 'SwiftPay Bank',
    mpinHash: sha256Hex(mpin),
    balance: 5000.00
  };
  wallets.set(upiId, wallet);

  res.json({
    message: 'Signup successful',
    user
  });
});

app.post('/api/v1/auth/login', (req, res) => {
  const { phone, mpin } = req.body;
  if (!phone || !mpin) {
    return res.status(400).json({ error: 'Phone and MPIN are required.' });
  }

  const user = users.get(phone);
  if (!user) {
    return res.status(400).json({ error: 'User not found.' });
  }

  const wallet = wallets.get(user.upiId);
  if (!wallet || wallet.mpinHash !== sha256Hex(mpin)) {
    return res.status(400).json({ error: 'Invalid MPIN.' });
  }

  res.json({
    message: 'Login successful',
    token: `demo_jwt_token_${user.id}`,
    user
  });
});

app.post('/api/v1/auth/otp/send', (req, res) => {
  const { phone } = req.body;
  res.json({ message: `OTP sent to ${phone}`, otp: '1234' });
});

// Wallet Routes
app.post('/api/v1/wallet/link', (req, res) => {
  const { phone, bankName, mpin } = req.body;
  if (!phone || !bankName || !mpin) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const user = users.get(phone);
  if (!user) {
    return res.status(400).json({ error: 'User not found' });
  }

  let wallet = wallets.get(user.upiId);
  if (wallet) {
    return res.status(400).json({ error: 'Wallet already linked' });
  }

  wallet = {
    upiId: user.upiId,
    userId: user.id,
    bankName,
    mpinHash: sha256Hex(mpin),
    balance: 10000.00
  };
  wallets.set(user.upiId, wallet);

  res.json({
    status: 'SUCCESS',
    walletId: `w_${user.id}`,
    balance: wallet.balance
  });
});

app.get('/api/v1/wallet/details', (req, res) => {
  const upiId = req.query.upiId;
  const wallet = findWallet(upiId);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }
  res.json(wallet);
});

app.get('/api/v1/wallet/transactions', (req, res) => {
  const upiId = req.query.upiId;
  const wallet = findWallet(upiId);
  const targetUpi = wallet ? wallet.upiId.toLowerCase() : (upiId ? upiId.toLowerCase() : '');
  const txs = transactions.filter(t => 
    t.senderVpa?.toLowerCase() === targetUpi || t.receiverVpa?.toLowerCase() === targetUpi
  );
  res.json(txs);
});

// Online Payment Handler
function handleOnlinePayment(req, res) {
  const senderVpa = req.body.senderVpa || req.body.senderUpiId;
  const receiverVpa = req.body.receiverVpa || req.body.receiverUpiId;
  const amount = Number(req.body.amount);
  const pin = req.body.pin || req.body.mpin;

  if (!senderVpa || !receiverVpa || amount === undefined || isNaN(amount) || !pin) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sender = findWallet(senderVpa);
  const receiver = findWallet(receiverVpa);

  if (!sender) {
    return res.status(400).json({ error: 'Sender wallet not found' });
  }
  if (!receiver) {
    return res.status(400).json({ error: 'Receiver wallet not found' });
  }

  if (sender.mpinHash !== sha256Hex(pin)) {
    return res.status(400).json({ error: 'Invalid MPIN' });
  }

  if (sender.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  sender.balance -= amount;
  receiver.balance += amount;

  const tx = recordTransaction({
    senderVpa: sender.upiId,
    receiverVpa: receiver.upiId,
    amount,
    signedAt: Date.now(),
    settledAt: Date.now(),
    status: 'SETTLED',
    type: 'ONLINE'
  });

  res.json({
    status: 'SUCCESS',
    transactionId: tx.transactionId,
    ...tx
  });
}

app.post('/api/v1/pay/online', handleOnlinePayment);
app.post('/api/v1/payments/online', handleOnlinePayment);

app.get('/api/v1/history/:upiId', (req, res) => {
  const upiId = req.params.upiId;
  const wallet = findWallet(upiId);
  const targetUpi = wallet ? wallet.upiId.toLowerCase() : (upiId ? upiId.toLowerCase() : '');
  const txs = transactions.filter(t => 
    t.senderVpa?.toLowerCase() === targetUpi || t.receiverVpa?.toLowerCase() === targetUpi
  );
  res.json(txs);
});

// Admin / Debug Endpoints
app.get('/api/wallets', (req, res) => {
  res.json(Array.from(wallets.values()));
});

app.get('/api/users', (req, res) => {
  res.json(Array.from(users.values()));
});

app.get('/api/transactions', (req, res) => {
  res.json(transactions.slice(0, 20));
});

// Export Express app for Vercel and serverless environments
export default app;

// Start Server in standalone / development environments
if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}
