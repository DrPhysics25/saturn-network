const express = require('express');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Safely handle Firebase service account key
let serviceAccount = null;

if (process.env.FIREBASE_KEY) {
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
} else if (fs.existsSync('./firebase-key.json')) {
    try {
        serviceAccount = require('./firebase-key.json');
    } catch (e) {
        console.log("Warning: firebase-key.json is empty or invalid.");
    }
}

let db = null;

if (serviceAccount && Object.keys(serviceAccount).length > 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://saturn-network-default-rtdb.firebaseio.com" // Update when you create your DB
    });
    db = admin.database();
    console.log("Connected to Firebase!");
} else {
    console.log("Running in offline mode (No Firebase key found).");
}

// 1. Authenticate & Create/Fetch Account
app.post('/api/auth', async (req, res) => {
    const { username, pin } = req.body;
    if (!username || !pin) return res.status(400).json({ error: "Username & PIN required." });

    const tag = username.toLowerCase().replace('@', '').trim();
    
    if (!db) {
        return res.json({ 
            status: "Authenticated (Offline Demo)", 
            user: { tag: `@${tag}`, balance: 100, pin: pin } 
        });
    }

    const userRef = db.ref(`users/${tag}`);
    const snap = await userRef.once('value');

    if (!snap.exists()) {
        const newUser = {
            tag: `@${tag}`,
            pin: pin,
            balance: 100,
            config: { theme: "dark", game_id: `PX_${tag.toUpperCase()}` }
        };
        await userRef.set(newUser);
        return res.json({ status: "Created", user: newUser });
    }

    const user = snap.val();
    if (user.pin !== pin) {
        return res.status(401).json({ error: "Invalid 4-Digit Security PIN!" });
    }

    res.json({ status: "Authenticated", user: user });
});

// 2. Transfer Ø
app.post('/api/transfer', async (req, res) => {
    const { senderTag, senderPin, receiverTag, amount, memo } = req.body;
    
    const sender = senderTag.toLowerCase().replace('@', '').trim();
    const receiver = receiverTag.toLowerCase().replace('@', '').trim();
    const txAmount = parseInt(amount);

    if (!sender || !receiver || isNaN(txAmount) || txAmount <= 0) {
        return res.status(400).json({ error: "Invalid transfer parameters." });
    }

    if (!db) {
        return res.json({ status: "Success (Offline Demo)", newBalance: 100 - txAmount });
    }

    const senderRef = db.ref(`users/${sender}`);
    const receiverRef = db.ref(`users/${receiver}`);

    const senderSnap = await senderRef.once('value');
    const receiverSnap = await receiverRef.once('value');

    if (!senderSnap.exists()) return res.status(404).json({ error: "Sender tag not found!" });
    if (!receiverSnap.exists()) return res.status(404).json({ error: "Recipient tag not found!" });

    const senderData = senderSnap.val();
    if (senderData.pin !== senderPin) return res.status(401).json({ error: "Unauthorized: Invalid PIN!" });
    if (senderData.balance < txAmount) return res.status(400).json({ error: "Insufficient Ø balance!" });

    await senderRef.update({ balance: senderData.balance - txAmount });
    await receiverRef.update({ balance: (receiverSnap.val().balance || 0) + txAmount });

    await db.ref('transactions').push({
        from: `@${sender}`,
        to: `@${receiver}`,
        amount: txAmount,
        memo: memo || "Saturn Settlement",
        timestamp: Date.now()
    });

    res.json({ status: "Success", newBalance: senderData.balance - txAmount });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Saturn Core Server live on http://localhost:${PORT}`);
});
0

