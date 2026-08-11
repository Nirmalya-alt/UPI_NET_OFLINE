let currentUser = null;
let isMeshMode = false;

// Helpers
function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

function showOverlay(text, contentHtml) {
    const overlay = document.getElementById('processing-overlay');
    overlay.innerHTML = contentHtml || `
        <div class="spinner"></div>
        <h3 id="processing-text">${text}</h3>
    `;
    overlay.classList.remove('hidden');
}

function hideOverlay() {
    document.getElementById('processing-overlay').classList.add('hidden');
}

// Auth
async function login() {
    const phone = document.getElementById('login-phone').value;
    const otp = document.getElementById('login-otp').value;
    
    if(!phone || !otp) return alert("Enter phone and OTP");

    try {
        const res = await fetch('/api/v1/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, mpin: otp, name: "User " + phone.substring(6) })
        });
        const data = await res.json();
        if(res.ok) {
            currentUser = data.user;
            await ensureWalletLinked(phone);
            initDashboard();
        } else if (data.error === "User not found.") {
            // Fallback to signup
            const signupRes = await fetch('/api/v1/auth/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone, mpin: otp, name: "User " + phone.substring(6) })
            });
            const signupData = await signupRes.json();
            if(signupRes.ok) {
                currentUser = signupData.user;
                await ensureWalletLinked(phone);
                initDashboard();
            } else {
                alert(signupData.error);
            }
        } else {
            alert(data.error);
        }
    } catch(e) {
        alert("Login failed. Backend running?");
    }
}

async function ensureWalletLinked(phone) {
    // Automatically link a wallet if they don't have one
    await fetch('/api/v1/wallet/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, bankName: "Demo Bank", mpin: "1234" })
    });
}

function logout() {
    currentUser = null;
    showScreen('auth-screen');
}

// Dashboard
async function initDashboard() {
    showScreen('dashboard-screen');
    document.getElementById('user-name').innerText = currentUser.name;
    document.getElementById('user-upi').innerText = currentUser.upiId;
    document.getElementById('user-avatar').innerText = currentUser.name.charAt(0);
    
    await refreshDashboard();
}

async function refreshDashboard() {
    if(!currentUser) return;

    // Fetch Wallet Balance
    const walletsRes = await fetch('/api/wallets');
    const wallets = await walletsRes.json();
    const myWallet = wallets.find(w => w.upiId === currentUser.upiId);
    if(myWallet) {
        document.getElementById('wallet-balance').innerText = "₹ " + parseFloat(myWallet.balance).toFixed(2);
    }

    // Fetch History
    await fetchHistory();
}

async function fetchHistory() {
    const res = await fetch(`/api/v1/history/${currentUser.upiId}`);
    const txs = await res.json();
    
    const list = document.getElementById('transaction-list');
    list.innerHTML = txs.map(tx => {
        const isDebit = tx.senderVpa === currentUser.upiId;
        const amountClass = isDebit ? 'debit' : 'credit';
        const sign = isDebit ? '-' : '+';
        const title = isDebit ? `Paid to ${tx.receiverVpa}` : `Received from ${tx.senderVpa}`;
        
        let statusClass = 'success';
        let statusText = 'SUCCESS';
        if(tx.status === 'REJECTED') { statusClass = 'failed'; statusText = 'FAILED'; }
        if(tx.type === 'MESH' && tx.status === 'SETTLED') { statusText = 'MESH SETTLED'; }

        return `
            <div class="tx-item">
                <div class="tx-left">
                    <span class="tx-title">${title}</span>
                    <span class="tx-date">${new Date(tx.settledAt).toLocaleString()} • ${tx.type}</span>
                </div>
                <div class="tx-right">
                    <span class="tx-amount ${amountClass}">${sign}₹${tx.amount.toFixed(2)}</span>
                    <span class="tx-status ${statusClass}">${statusText}</span>
                </div>
            </div>
        `;
    }).join('');
}

// Network Toggle
function toggleNetworkMode() {
    isMeshMode = document.getElementById('offline-toggle').checked;
    const statusDiv = document.getElementById('network-status');
    const statusText = document.getElementById('network-status-text');
    
    if(isMeshMode) {
        statusDiv.className = 'status-indicator offline';
        statusText.innerText = 'Offline Mesh Active';
    } else {
        statusDiv.className = 'status-indicator online';
        statusText.innerText = 'Connected to Bank';
    }
}

// Payment
async function processPayment() {
    const receiver = document.getElementById('pay-receiver').value;
    const amount = document.getElementById('pay-amount').value;
    const mpin = document.getElementById('pay-mpin').value;

    if(!receiver || !amount || !mpin) return alert("Fill all fields");

    showOverlay("Processing...");

    try {
        if(isMeshMode) {
            // Offline Mode Simulation -> Inject to Mesh
            const res = await fetch('/api/demo/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    senderVpa: currentUser.upiId,
                    receiverVpa: receiver,
                    amount: parseFloat(amount),
                    pin: mpin,
                    startDevice: 'app-user'
                })
            });
            const data = await res.json();
            
            setTimeout(() => {
                showOverlay("Sent", `
                    <div class="mesh-icon">📡</div>
                    <h3>Packet Encrypted & Broadcasted!</h3>
                    <p style="color:#8b949e;font-size:12px;margin-top:8px">Will settle when network is found.</p>
                `);
                setTimeout(() => { hideOverlay(); showScreen('dashboard-screen'); }, 3000);
            }, 1000);

        } else {
            // Online Mode
            const res = await fetch('/api/v1/pay/online', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    senderUpiId: currentUser.upiId,
                    receiverUpiId: receiver,
                    amount: amount,
                    mpin: mpin
                })
            });
            const data = await res.json();
            
            if(res.ok) {
                setTimeout(() => {
                    showOverlay("Success", `
                        <div class="success-check">✓</div>
                        <h3>Payment Successful</h3>
                    `);
                    setTimeout(() => { 
                        hideOverlay(); 
                        document.getElementById('pay-receiver').value = '';
                        document.getElementById('pay-amount').value = '';
                        refreshDashboard();
                        showScreen('dashboard-screen'); 
                    }, 2000);
                }, 1000);
            } else {
                hideOverlay();
                alert(data.error);
            }
        }
    } catch(e) {
        hideOverlay();
        alert("Payment failed: " + e.message);
    }
}
