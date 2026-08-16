# SwiftPay — Offline UPI Mesh Payments

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.19-blue.svg)](https://expressjs.com)
[![Deployed on Vercel](https://img.shields.io/badge/Deploy-Vercel-black.svg?logo=vercel)](https://vercel.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An end-to-end demonstration of **offline UPI payments routed through a Bluetooth gossip mesh network and settled asynchronously upon internet reconnection**.

Imagine you are in a remote basement or airplane cabin with zero cellular network or Wi-Fi. You send a payment of ₹500 to a friend. Your device signs and hybrid-encrypts the transaction, then broadcasts it to nearby devices. The encrypted packet hops peer-to-peer across bystander devices until a device with internet connectivity walks into network range and silently forwards it to the banking backend for cryptographic verification, deduplication, and atomic settlement.

---

## 🚀 Key Features & Architectural Highlights

1. **Hybrid RSA-2048 + AES-256-GCM Cryptography**:
   - Every transaction payload is encrypted with an ephemeral AES-256 session key, which is itself encrypted with the banking server's RSA-2048 public key (OAEP-SHA256).
   - Untrusted intermediary nodes carry opaque ciphertexts and cannot view transaction amounts, recipient VPAs, or alter any payload bits without triggering GCM authentication tag validation failures.

2. **Atomic Idempotency & Deduplication**:
   - Prevents duplicate debiting when multiple bridge nodes simultaneously upload the same gossiped packet.
   - Computes `SHA-256(ciphertext)` on ingress to claim execution rights before expensive RSA decryption occurs.

3. **Freshness & Replay Attack Defense**:
   - Each payment instruction contains a cryptographically random UUID nonce and timestamp (`signedAt`) enclosed inside the authenticated ciphertext.
   - Packets older than 24 hours or future-dated packets are discarded.

4. **Dual Frontend Interfaces**:
   - **SwiftPay Mobile Wallet Web App (`/dashboard.html` / `/`)**: Complete wallet interface with PIN authentication, balance checking, send money flow, transaction histories, and live mesh simulation controls.
   - **MeshPay Companion Simulator (`/app.html`)**: Mobile simulator with live mesh mode toggles and transaction broadcast visualizer.

---

## 📐 Architecture Diagram

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                         SENDER PHONE (Offline)                          │
│  PaymentInstruction { sender, receiver, amount, pinHash, nonce, time }  │
│              │                                                          │
│              ▼ Encrypt with Server RSA Public Key (AES-256-GCM + OAEP)   │
│   MeshPacket { packetId, ttl, createdAt, ciphertext }                   │
└──────────────────────────────────────┬──────────────────────────────────┘
                                       │ Bluetooth Low Energy / Mesh Gossip
                                       ▼
        ┌─────────┐  hop   ┌─────────┐  hop   ┌─────────┐
        │Stranger1│ ─────▶ │Stranger2│ ─────▶ │ Bridge  │ ◀── Walks outside /
        └─────────┘        └─────────┘        └────┬────┘     connects to 4G
                                                   │
                                                   ▼ HTTPS POST /api/bridge/ingest
┌─────────────────────────────────────────────────────────────────────────┐
│                    SWIFTPAY BACKEND (Node.js / Express)                 │
│                                                                         │
│  /api/bridge/ingest                                                     │
│       │                                                                 │
│       ▼                                                                 │
│  [1] Hash Ciphertext (SHA-256)                                          │
│       │                                                                 │
│       ▼                                                                 │
│  [2] Idempotency Gate (claim hash; duplicate packets dropped instantly) │
│       │                                                                 │
│       ▼                                                                 │
│  [3] RSA-OAEP Key Unwrapping + AES-256-GCM Authenticated Decryption     │
│       │                                                                 │
│       ▼                                                                 │
│  [4] Freshness Check (signedAt validation within 24 hours)              │
│       │                                                                 │
│       ▼                                                                 │
│  [5] Atomic Ledger Settlement & Balance Update                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Quick Start & Local Setup

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or newer)
- npm or yarn

### Installation & Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Nirmalya-alt/upi_without_net.git
   cd upi_without_net
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Or run the production start script:
   ```bash
   npm start
   ```

4. **Open in browser:**
   - **Primary SwiftPay Application:** [http://localhost:3000](http://localhost:3000)
   - **Companion Mobile Simulator:** [http://localhost:3000/app.html](http://localhost:3000/app.html)

---

## ⚡ Deployment to Vercel

This repository is pre-configured with `vercel.json` and a serverless entrypoint in `api/index.js`.

### One-Click Deployment via Vercel CLI
```bash
npm install -g vercel
vercel
```

### Git-Based Deployment via Vercel Dashboard
1. Push this repository to your GitHub account.
2. Import the repository in [Vercel Dashboard](https://vercel.com/new).
3. Framework Preset: **Other**.
4. Root Directory: `./`
5. Click **Deploy**.

---

## 🧪 Running Automated Tests

Run the test suite covering hybrid encryption, tamper detection, and idempotency guarantees:

```bash
npm test
```

Expected output:
```text
🧪 Running UPI Mesh Payments Test Suite...

✅ Test 1 Passed: Hybrid RSA-OAEP + AES-256-GCM Encrypt/Decrypt Roundtrip
✅ Test 2 Passed: Tampered Ciphertext Detected and Rejected
✅ Test 3 Passed: Idempotency Cache Drops Concurrent Duplicates

🎉 All tests passed successfully!
```

---

## 📚 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` / `/dashboard.html` | SwiftPay Wallet & Mesh UI |
| `GET` | `/app.html` | MeshPay Simulator UI |
| `GET` | `/api/server-key` | Retrieve server RSA public key (base64) & cipher parameters |
| `POST` | `/api/demo/send` | Encrypt & inject an offline payment packet into a mesh node |
| `GET` | `/api/mesh/state` | Inspect current devices, packet queues, and idempotency count |
| `POST` | `/api/mesh/gossip` | Trigger peer-to-peer packet broadcasting across mesh nodes |
| `POST` | `/api/mesh/flush` | Upload queued packets from internet-connected bridge nodes |
| `POST` | `/api/mesh/reset` | Clear simulation state and idempotency memory |
| `POST` | `/api/bridge/ingest` | Production ingestion gateway for bridge nodes |
| `POST` | `/api/v1/auth/signup` | Register a new user account and provision wallet |
| `POST` | `/api/v1/auth/login` | Authenticate user via MPIN |
| `POST` | `/api/v1/pay/online` | Direct online UPI payment endpoint |
| `GET` | `/api/v1/wallet/details` | Fetch balance and metadata for a UPI ID or Phone |
| `GET` | `/api/v1/history/:upiId` | Retrieve transaction history for a given account |

---

## 🔒 Pre-Seeded Demo Accounts

For testing out-of-the-box:

| Name | Phone Number | UPI ID | Default Balance | Default MPIN |
|---|---|---|---|---|
| Alice | `9000000001` | `alice@meshpay` | ₹ 5,000.00 | `1234` |
| Bob | `9000000002` | `bob@meshpay` | ₹ 1,000.00 | `1234` |
| Carol | `9000000003` | `carol@meshpay` | ₹ 2,500.00 | `1234` |
| Dave | `9000000004` | `dave@meshpay` | ₹ 500.00 | `1234` |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
