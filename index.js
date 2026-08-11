// SwiftPay Core Logic
(function() {
    const ui = {
        showView: function(viewId) {
            console.log("Showing view:", viewId);
            const allViews = document.querySelectorAll('[id^="view-"]');
            allViews.forEach(v => {
                v.classList.add('view-hidden');
                v.classList.remove('view-active');
            });
            
            const target = document.getElementById('view-' + viewId);
            if (target) {
                target.classList.remove('view-hidden');
                target.classList.add('view-active');
            }

            // Toggle bottom nav visibility
            const bottomNav = document.getElementById('bottom-nav');
            const isDashboardView = ['home', 'activity', 'send', 'settings'].includes(viewId);
            if (isDashboardView) {
                bottomNav.classList.remove('view-hidden');
                bottomNav.classList.add('view-active');
            } else {
                bottomNav.classList.add('view-hidden');
                bottomNav.classList.remove('view-active');
            }

            // Update footer navigation active state
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
                if (item.getAttribute('data-view') === viewId) {
                    item.classList.add('active');
                }
            });

            // Load data based on view
            if (viewId === 'home') dashboard.load();
            if (viewId === 'activity') dashboard.loadTransactions(false, 'all');
        },

        showModal: function(message, title = "Success!") {
            console.log("Showing modal:", title, message);
            const modal = document.getElementById('modal-success');
            const msgEl = document.getElementById('success-message');
            const titleEl = modal.querySelector('h2');
            
            if (msgEl) msgEl.innerText = message;
            if (titleEl) titleEl.innerText = title;
            if (modal) modal.style.display = 'flex';
        },

        closeModal: function() {
            const modal = document.getElementById('modal-success');
            if (modal) modal.style.display = 'none';
        }
    };

    const auth = {
        signup: async function() {
            const name = document.getElementById('signup-name').value;
            const phone = document.getElementById('signup-phone').value;
            const mpin = document.getElementById('signup-mpin').value;

            if (!name || !phone || !mpin) return alert("Please fill all fields");

            try {
                const res = await fetch('/api/v1/auth/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, phone, mpin })
                });

                const data = await res.json();
                if (res.ok) {
                    ui.showModal("Account created successfully! You can now login.", "Welcome!");
                    ui.showView('login');
                } else {
                    alert(data.error || "Signup failed");
                }
            } catch (e) {
                alert("Connection error. Is the server running?");
            }
        },

        login: async function() {
            const phone = document.getElementById('login-phone').value;
            const mpin = document.getElementById('login-mpin').value;

            if (!phone || !mpin) return alert("Please fill all fields");

            try {
                const res = await fetch('/api/v1/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, mpin })
                });

                const data = await res.json();
                if (res.ok) {
                    localStorage.setItem('user', JSON.stringify(data.user));
                    ui.showView('home');
                } else {
                    alert(data.error || "Login failed");
                }
            } catch (e) {
                alert("Connection error");
            }
        },

        logout: function() {
            localStorage.removeItem('user');
            ui.showView('login');
        },

        getCurrentUser: function() {
            const user = localStorage.getItem('user');
            return user ? JSON.parse(user) : null;
        }
    };

    const dashboard = {
        load: async function() {
            const user = auth.getCurrentUser();
            if (!user) return ui.showView('login');

            document.getElementById('home-upi-id').innerText = user.upiId;
            document.getElementById('settings-name').innerText = user.name;
            document.getElementById('settings-upi').innerText = user.upiId;

            try {
                const res = await fetch(`/api/v1/wallet/details?upiId=${user.upiId}`);
                if (res.ok) {
                    const wallet = await res.json();
                    document.getElementById('home-balance').innerText = wallet.balance.toFixed(2);
                }
                dashboard.loadTransactions(true);
            } catch (e) { console.error("Load failed", e); }
        },

        filterHistory: function(type, btn) {
            console.log("Filtering history:", type);
            // Update active button UI
            document.querySelectorAll('#history-filters .filter-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            
            dashboard.loadTransactions(false, type);
        },

        loadTransactions: async function(recentOnly = false, filter = 'all') {
            const user = auth.getCurrentUser();
            if (!user) return;

            try {
                const res = await fetch(`/api/v1/wallet/transactions?upiId=${user.upiId}`);
                if (res.ok) {
                    let txs = await res.json();
                    const listId = recentOnly ? 'home-activity-list' : 'full-activity-list';
                    const list = document.getElementById(listId);
                    if (!list) return;
                    
                    list.innerHTML = '';
                    
                    const myUpi = user.upiId.toLowerCase();
                    if (filter === 'sent') {
                        txs = txs.filter(tx => tx.senderVpa.toLowerCase() === myUpi);
                    } else if (filter === 'received') {
                        txs = txs.filter(tx => tx.receiverVpa.toLowerCase() === myUpi);
                    }

                    const displayTxs = recentOnly ? txs.slice(0, 5) : txs;
                    
                    if (displayTxs.length === 0) {
                        list.innerHTML = `<div style="padding: 40px 20px; text-align: center; color: #999;">
                            <i class="fas fa-receipt" style="font-size: 2rem; margin-bottom: 10px; opacity: 0.3;"></i>
                            <p>No ${filter !== 'all' ? filter : ''} transactions yet</p>
                        </div>`;
                        return;
                    }

                    displayTxs.forEach(tx => {
                        const isDebit = tx.senderVpa.toLowerCase() === myUpi;
                        const otherParty = isDebit ? tx.receiverVpa : tx.senderVpa;
                        const date = new Date(tx.settledAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' });
                        
                        const item = document.createElement('div');
                        item.className = 'activity-item';
                        item.innerHTML = `
                            <div class="activity-icon" style="background: ${isDebit ? '#FFF0F0' : '#E8F5E9'}; color: ${isDebit ? '#DC3545' : '#28A745'}">
                                <i class="fas ${isDebit ? 'fa-arrow-up' : 'fa-arrow-down'}"></i>
                            </div>
                            <div class="activity-details">
                                <div class="activity-name">${otherParty}</div>
                                <div class="activity-time">${date} • ${tx.type}</div>
                            </div>
                            <div class="activity-amount ${isDebit ? 'amount-debit' : 'amount-credit'}">
                                ${isDebit ? '-' : '+'} ₹${tx.amount.toFixed(2)}
                            </div>
                        `;
                        list.appendChild(item);
                    });
                }
            } catch (e) { console.error("TX load failed", e); }
        }
    };

    const payments = {
        currentAmount: 0,
        addAmount: function(amt) {
            payments.currentAmount += amt;
            document.getElementById('send-amount-display').innerText = payments.currentAmount;
        },
        sendOnline: async function() {
            const user = auth.getCurrentUser();
            const recipient = document.getElementById('send-recipient').value;
            const pin = document.getElementById('send-pin').value;
            
            if (!recipient || payments.currentAmount <= 0 || !pin) {
                return alert("Please enter recipient, amount and PIN");
            }

            try {
                const res = await fetch('/api/v1/payments/online', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        senderVpa: user.upiId,
                        receiverVpa: recipient.includes('@') ? recipient : recipient + '@swiftpay',
                        amount: payments.currentAmount,
                        pin: pin
                    })
                });

                if (res.ok) {
                    ui.showModal(`₹ ${payments.currentAmount} sent to ${recipient}`);
                    payments.currentAmount = 0;
                    document.getElementById('send-amount-display').innerText = '0';
                    document.getElementById('send-recipient').value = '';
                    document.getElementById('send-pin').value = '';
                } else {
                    const data = await res.json();
                    alert(data.error || "Payment failed");
                }
            } catch (e) {
                alert("Payment error");
            }
        }
    };

    // Export to global scope
    window.ui = ui;
    window.auth = auth;
    window.dashboard = dashboard;
    window.payments = payments;

    // Initialization
    document.addEventListener('DOMContentLoaded', () => {
        console.log("SwiftPay Initializing...");
        if (auth.getCurrentUser()) {
            ui.showView('home');
        } else {
            ui.showView('login');
        }
    });
})();
