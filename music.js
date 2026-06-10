require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 80;

// ==========================================
// 1. MIDDLEWARE & CONFIGURATION
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

let db, bucket;
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("❌ FATAL ERROR: Missing FIREBASE_SERVICE_ACCOUNT_JSON!");
} else {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        admin.initializeApp({ credential: admin.credential.cert(serviceAccount), storageBucket: process.env.FIREBASE_STORAGE_BUCKET });
        console.log('✅ Google Firebase Database Connected!');
        db = admin.firestore(); 
    } catch (error) { console.error('❌ Firebase Error:', error.message); }
}

if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
}

// Memory storage for immediate processing
const upload = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if(file.mimetype.includes('audio') || file.mimetype.includes('video') || file.mimetype.includes('image') || file.originalname.match(/\.(mp3|m4a|mp4|jpg|jpeg|png)$/i)) cb(null, true); 
        else cb(new Error('Invalid file type.'));
    }
});

function uploadStreamToCloudinary(buffer, resourceType, folder) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream({ folder: folder, resource_type: resourceType }, (error, result) => {
            if (error) reject(error); else resolve(result);
        });
        Readable.from(buffer).pipe(stream);
    });
}

async function uploadToCloudinaryBase64(base64Str, folder) {
    if(!base64Str) return '';
    const result = await cloudinary.uploader.upload(base64Str, { folder: folder, resource_type: "auto" });
    return result.secure_url;
}

// ==========================================
// 2. HTML ROUTES & ANTI-THEFT STREAMING
// ==========================================
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'music.html')); });
app.get('/profile.html', (req, res) => { res.sendFile(path.join(__dirname, 'profile.html')); });
app.get('/manager.html', (req, res) => { res.sendFile(path.join(__dirname, 'manager.html')); });
app.get('/vip.html', (req, res) => { res.sendFile(path.join(__dirname, 'vip.html')); });

async function logEvent(type, message) { try { if(db) await db.collection('logs').add({ type, message, timestamp: new Date().toISOString() }); } catch(e) {} }

app.get('/api/stream/:songId', async (req, res) => {
    try {
        if(!db) return res.status(500).send('Database not connected');
        const isAudioTag = req.headers['sec-fetch-dest'] === 'audio' || req.headers['sec-fetch-dest'] === 'video';
        const referer = req.headers.referer || '';
        const isFromApp = referer.includes(req.get('host'));

        if (!isFromApp && !isAudioTag) {
            return res.status(403).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>403 - Forbidden</title><style>body { background-color: #2b0a0a; color: #ff453a; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; } h1 { font-size: 36px; font-weight: 800; letter-spacing: 2px; text-shadow: 0 4px 15px rgba(0,0,0,0.5); }</style></head><body><h1>禁止盗取歌曲</h1></body></html>`);
        }

        const songDoc = await db.collection('songs').doc(req.params.songId).get();
        if (!songDoc.exists) return res.status(404).send('Song not found');
        
        const fetchHeaders = {}; if (req.headers.range) fetchHeaders.Range = req.headers.range;
        const response = await fetch(songDoc.data().filepath, { headers: fetchHeaders });
        if (!response.ok) throw new Error('Cloudinary fetch failed');

        const contentType = response.headers.get('content-type'); const contentLength = response.headers.get('content-length'); const contentRange = response.headers.get('content-range'); const acceptRanges = response.headers.get('accept-ranges');
        if (contentType) res.setHeader('Content-Type', contentType); if (contentLength) res.setHeader('Content-Length', contentLength); if (contentRange) res.setHeader('Content-Range', contentRange); if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

        res.status(response.status); 
        Readable.fromWeb(response.body).pipe(res);
    } catch (e) { console.error('Stream Error:', e.message); res.status(500).end(); }
});

// ==========================================
// 3. AUTHENTICATION & USER MANAGEMENT
// ==========================================
app.post('/api/register', async (req, res) => {
    try {
        if(!db) return res.status(500).send('DB disconnected');
        const { contact, username, password } = req.body;
        const userRef = db.collection('users').doc(username.toLowerCase());
        if ((await userRef.get()).exists) return res.status(400).send('USER HAS BEEN REGISTERED');
        if (!(await db.collection('users').where('contact', '==', contact).get()).empty) return res.status(400).send('USER HAS BEEN REGISTERED');
        
        const sysDoc = await db.collection('settings').doc('global').get();
        let startTokens = 0;
        if(sysDoc.exists) {
            const sysData = sysDoc.data();
            if(sysData.activity && sysData.activity.enabled) {
                startTokens = parseInt(sysData.activity.reward) || 0;
                const act = sysData.activity; act.count = (act.count || 0) + 1; act.total = (act.total || 0) + startTokens;
                await db.collection('settings').doc('global').update({ activity: act });
            }
        }

        const isEmail = contact.includes('@');
        await userRef.set({ 
            username, contact, password, email: isEmail ? contact : '-', phone: isEmail ? '-' : contact, 
            tokens: startTokens, profilePic: '', purchases: [], topups: [], favorites: [], following: [], followers: [], 
            role: 'NORMAL', isVip: false, wechat: '', wechatPublic: false, status: 'ACTIVE', banReason: '', createdAt: new Date().toISOString() 
        });
        await logEvent('register', `<span style="color:#34c759; font-weight:600;">${username}</span> registered with ${contact} (Received ${startTokens}💎)`);
        res.json({ success: true, username });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { contact, password } = req.body;
        let uDoc = await db.collection('users').doc(contact.toLowerCase()).get();
        if (!uDoc.exists) { const q = await db.collection('users').where('contact', '==', contact).get(); if(!q.empty) uDoc = q.docs[0]; }
        if (!uDoc || !uDoc.exists) return res.status(400).send('Invalid credentials.');
        
        if (uDoc.data().status === 'BANNED') return res.status(403).send(`Account Banned: ${uDoc.data().banReason || 'Violation of terms'}`);
        if (uDoc.data().password === password) res.json({ success: true, username: uDoc.data().username }); 
        else res.status(400).send('Invalid credentials.');
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/users/:username', async (req, res) => {
    const doc = await db.collection('users').doc(req.params.username.toLowerCase()).get();
    if (doc.exists) {
        if(doc.data().status === 'BANNED') return res.status(404).send('Banned');
        let data = doc.data(); delete data.password;
        res.json(data);
    } else res.status(404).send('User not found');
});

app.get('/api/all-users', async (req, res) => { 
    try { 
        const users = (await db.collection('users').get()).docs.map(d => {
            let data = d.data(); delete data.password; 
            return data;
        });
        res.json(users); 
    } catch (e) { res.status(500).json([]); }
});

app.put('/api/users/:username/change-username', async (req, res) => {
    try {
        const oldId = req.params.username.toLowerCase(), newId = req.body.newUsername.toLowerCase();
        if ((await db.collection('users').doc(newId).get()).exists) return res.status(400).send('Username taken.');
        const oldRef = db.collection('users').doc(oldId); const doc = await oldRef.get();
        const data = doc.data(); data.username = req.body.newUsername; 
        await db.collection('users').doc(newId).set(data); await oldRef.delete();
        res.json({ success: true, username: req.body.newUsername });
    } catch (e) { res.status(500).send(e.message); }
});

// ==========================================
// 4. FOLLOWERS, FAVORITES, TOPUPS & PURCHASES
// ==========================================
app.post('/api/users/:username/follow', async (req, res) => {
    try {
        const { targetUser } = req.body;
        const currentUserId = req.params.username.toLowerCase();
        const targetId = targetUser.toLowerCase();

        const userRef = db.collection('users').doc(currentUserId);
        const targetRef = db.collection('users').doc(targetId);

        const [userDoc, targetDoc] = await Promise.all([userRef.get(), targetRef.get()]);
        if (!userDoc.exists || !targetDoc.exists) return res.status(404).send('User not found');

        let following = userDoc.data().following || [];
        let followers = targetDoc.data().followers || [];

        if (following.includes(targetUser)) {
            following = following.filter(u => u !== targetUser);
            followers = followers.filter(u => u !== req.params.username);
        } else {
            following.push(targetUser);
            followers.push(req.params.username);
        }

        await userRef.update({ following });
        await targetRef.update({ followers });

        res.json({ success: true, following, followersCount: followers.length });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/users/:username/favorites', async (req, res) => {
    try {
        const { songId } = req.body;
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).send('User not found');
        
        let favs = userDoc.data().favorites || [];
        if(favs.includes(songId)) favs = favs.filter(id => id !== songId);
        else favs.push(songId);
        
        await userRef.update({ favorites: favs });
        res.json({ success: true, favorites: favs });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/users/:username/topup', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase()); const doc = await userRef.get();
        const user = doc.data();
        const newTokens = (user.tokens || 0) + req.body.amount; 
        const topups = user.topups || [];
        const orderId = 'TP' + Date.now() + Math.random().toString(36).substring(2,7).toUpperCase();
        topups.push({ amount: req.body.amount, price: req.body.price || 0, currency: req.body.currency || 'RMB', date: new Date().toISOString() });
        
        await userRef.update({ tokens: newTokens, topups: topups }); 
        
        await db.collection('orders').add({
            user: req.params.username, email: user.email || '-',
            orderId: orderId, amount: req.body.amount, price: req.body.price || 0, currency: req.body.currency || 'RMB',
            method: req.body.currency === 'MYR' ? 'SUPERPAY_FPX' : 'ALIPAY/WECHAT',
            status: 'COMPLETED', time: new Date().toISOString()
        });

        res.json({ tokens: newTokens, topups: topups });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/users/:username/purchase', async (req, res) => {
    try {
        const songDoc = await db.collection('songs').doc(req.body.songId).get(); if (!songDoc.exists) return res.status(404).send('Song not found');
        const song = songDoc.data();
        const userRef = db.collection('users').doc(req.params.username.toLowerCase()); const userDoc = await userRef.get();
        const user = userDoc.data(); user.purchases = user.purchases || [];
        if (user.purchases.find(p => p.songId === req.body.songId)) return res.status(400).send('Already purchased');

        const price = song.price !== undefined ? song.price : 10;
        if (user.tokens >= price) {
            user.tokens -= price;
            const purchaseId = Math.random().toString(36).substr(2, 10).toUpperCase();
            
            user.purchases.push({ 
                songId: req.body.songId, songName: song.filename, filepath: song.filepath, coverUrl: song.coverUrl, 
                uploader: song.uploader || 'FULLKIK', 
                tokensSpent: price, purchaseId, purchaseTime: new Date().toISOString() 
            });
            
            await userRef.update({ tokens: user.tokens, purchases: user.purchases });
            await db.collection('songs').doc(req.body.songId).update({ downloads: admin.firestore.FieldValue.increment(1) });

            await db.collection('transactions').add({
                buyer: req.params.username, email: user.email || '-',
                songName: song.filename, uploader: song.uploader || 'FULLKIK',
                tokens: price, time: new Date().toISOString()
            });

            res.json({ success: true, tokens: user.tokens, purchases: user.purchases });
        } else res.status(400).send('Insufficient tokens');
    } catch (e) { res.status(500).send(e.message); }
});

app.put('/api/users/:username/update-purchases-order', async (req, res) => {
    try {
        const newOrder = req.body.purchases;
        if(!newOrder || !Array.isArray(newOrder)) return res.status(400).send("Invalid format");
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ purchases: newOrder });
        res.json({ success: true, purchases: newOrder });
    } catch(e) { res.status(500).send(e.message); }
});

// ==========================================
// 5. ADMIN USER MANAGEMENT & LOGS
// ==========================================
app.put('/api/admin/users/:username/role', async (req, res) => {
    try {
        const role = req.body.role || (req.body.isVip ? 'VIP' : 'NORMAL');
        const isVip = role === 'VIP' || role === 'PRODUCER';
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ isVip: isVip, role: role });
        await logEvent('admin', `Updated role for ${req.params.username} to ${role}`);
        res.send('Updated');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/adjust-tokens', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        const amt = parseInt(req.body.amount) || 0;
        const newTokens = (doc.data().tokens || 0) + amt;
        await userRef.update({ tokens: newTokens });
        await logEvent('admin', `Adjusted tokens for ${req.params.username} by ${amt > 0 ? '+'+amt : amt}. Reason: ${req.body.reason}`);
        res.send('Adjusted');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/force-password', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ password: req.body.newPassword });
        await logEvent('admin', `Forced password reset for ${req.params.username}`);
        res.send('Reset');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/ban', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ status: 'BANNED', banReason: req.body.reason });
        await logEvent('admin', `Banned user <span style="color:var(--danger)">${req.params.username}</span>. Reason: ${req.body.reason}`);
        res.send('Banned');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/unban', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ status: 'ACTIVE', banReason: '' });
        await logEvent('admin', `Unbanned user <span style="color:var(--success)">${req.params.username}</span>.`);
        res.send('Unbanned');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/users/:username/vip', async (req, res) => {
    try {
        const { djName, wechat } = req.body;
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ isVip: true, role: 'VIP', djName: djName, wechat: wechat, wechatPublic: true });
        res.send('VIP Activated');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/users/:username/settings', async (req, res) => {
    try {
        let updates = {};
        if(req.body.wechat !== undefined) updates.wechat = req.body.wechat;
        if(req.body.wechatPublic !== undefined) updates.wechatPublic = req.body.wechatPublic;
        await db.collection('users').doc(req.params.username.toLowerCase()).update(updates);
        res.send('Settings Updated');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/users/:username/update-password', async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if (doc.data().password !== oldPassword) return res.status(400).send('Incorrect current password');
        await userRef.update({ password: newPassword });
        res.send('Password updated');
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/users/:username/profile-pic', async (req, res) => {
    try {
        const url = await uploadToCloudinaryBase64(req.body.imageBase64, 'dj_profiles');
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ profilePic: url }); res.json({ profilePic: url });
    } catch (e) { res.status(500).send(e.message); }
});

// --- ADMIN TRANSACTIONS & ORDERS ---
app.get('/api/orders', async (req, res) => {
    try { res.json((await db.collection('orders').orderBy('time', 'desc').get()).docs.map(d => ({id: d.id, ...d.data()}))); } catch(e) { res.json([]); }
});
app.delete('/api/orders/all', async (req, res) => {
    try { const b = db.batch(); (await db.collection('orders').get()).docs.forEach(d => b.delete(d.ref)); await b.commit(); res.send('ok'); } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/transactions', async (req, res) => {
    try { res.json((await db.collection('transactions').orderBy('time', 'desc').get()).docs.map(d => ({id: d.id, ...d.data()}))); } catch(e) { res.json([]); }
});
app.delete('/api/transactions/all', async (req, res) => {
    try { const b = db.batch(); (await db.collection('transactions').get()).docs.forEach(d => b.delete(d.ref)); await b.commit(); res.send('ok'); } catch(e) { res.status(500).send(e.message); }
});

// ==========================================
// 6. GENRES AND SONGS
// ==========================================
app.get('/api/genres', async (req, res) => {
    try { res.json((await db.collection('genres').orderBy('sequence').get()).docs.map(d => ({ id: d.id, ...d.data() }))); } catch(e) { res.status(500).json([]); }
});
app.post('/api/genres', async (req, res) => {
    try {
        let coverUrl = req.body.coverBase64 ? await uploadToCloudinaryBase64(req.body.coverBase64, 'dj_genres') : '';
        const newGenre = { name: req.body.name, coverUrl, status: 'ACTIVE', sequence: (await db.collection('genres').get()).size + 1 };
        const docRef = await db.collection('genres').add(newGenre); res.json({ id: docRef.id, ...newGenre });
    } catch(e) { res.status(500).send(e.message); }
});
app.put('/api/genres/:id', async (req, res) => {
    try {
        let updates = {};
        if(req.body.name) updates.name = req.body.name;
        if(req.body.status) updates.status = req.body.status;
        if(req.body.sequence !== undefined) updates.sequence = parseInt(req.body.sequence);
        if(req.body.coverBase64) updates.coverUrl = await uploadToCloudinaryBase64(req.body.coverBase64, 'dj_genres');
        await db.collection('genres').doc(req.params.id).update(updates); res.send('Updated');
    } catch(e) { res.status(500).send(e.message); }
});
app.put('/api/genres/reorder', async (req, res) => {
    try {
        const batch = db.batch(); req.body.orderedIds.forEach((id, index) => { batch.update(db.collection('genres').doc(id), { sequence: index + 1 }); }); await batch.commit(); res.send('Reordered');
    } catch(e) { res.status(500).send(e.message); }
});
app.delete('/api/genres/:id', async (req, res) => { await db.collection('genres').doc(req.params.id).delete(); res.send('Deleted'); });

app.get('/api/songs', async (req, res) => {
    try { res.json((await db.collection('songs').orderBy('sequence').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))); } catch(e) { res.status(500).json([]); }
});

const DEFAULT_COVER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%231a0f0f'/%3E%3Ctext x='50' y='65' font-size='50' text-anchor='middle' fill='white'%3E🎧%3C/text%3E%3C/svg%3E";

async function saveSongData(fileBuffer, originalName, reqBody) {
    let url = '';
    if(fileBuffer) {
        const audioResult = await uploadStreamToCloudinary(fileBuffer, "video", "dj_music");
        url = audioResult.secure_url;
    } else if(reqBody.url) {
        url = reqBody.url;
    }

    let coverUrl = DEFAULT_COVER; 
    if(reqBody.coverBase64 && !reqBody.coverBase64.includes('<svg')) {
        coverUrl = await uploadToCloudinaryBase64(reqBody.coverBase64, 'dj_covers');
    }

    const snapshot = await db.collection('songs').get();
    const newSong = {
        filename: reqBody.title || originalName, filepath: url, coverUrl: coverUrl, genreId: reqBody.genreId || 'none',
        size: fileBuffer ? fileBuffer.length : 0, uploadTime: new Date().toISOString(), sequence: snapshot.size + 1, price: parseInt(reqBody.price) || 0,
        downloads: 0, plays: 0, status: reqBody.status || 'APPROVED', uploader: reqBody.uploader || 'FULLKIK', rejectReason: ''
    };
    const docRef = await db.collection('songs').add(newSong); return { id: docRef.id, ...newSong };
}

app.post('/api/upload', upload.single('mp3file'), async (req, res) => {
    try { if (!req.file) return res.status(400).send('No file.'); res.json(await saveSongData(req.file.buffer, req.file.originalname, req.body)); } 
    catch (e) { res.status(500).send(e.message); }
});

app.post('/api/transload', async (req, res) => {
    try {
        res.json(await saveSongData(null, 'TransloadedTrack.m4a', req.body));
    } catch (e) { res.status(400).send(e.message); }
});

app.put('/api/songs/:id/settings', async (req, res) => {
    try {
        let updates = {};
        if (req.body.newName) updates.filename = req.body.newName;
        if (req.body.newPrice !== undefined) updates.price = parseInt(req.body.newPrice) || 0;
        if (req.body.status) updates.status = req.body.status; 
        if (req.body.genreId) updates.genreId = req.body.genreId;
        if (req.body.rejectReason !== undefined) updates.rejectReason = req.body.rejectReason;
        if (req.body.coverBase64 && !req.body.coverBase64.includes('<svg')) updates.coverUrl = await uploadToCloudinaryBase64(req.body.coverBase64, 'dj_covers');
        await db.collection('songs').doc(req.params.id).update(updates); res.send('Updated');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/songs/reorder', async (req, res) => {
    const batch = db.batch(); req.body.orderedIds.forEach((id, index) => { batch.update(db.collection('songs').doc(id), { sequence: index + 1 }); }); await batch.commit(); res.send('Reordered');
});
app.delete('/api/songs/:id', async (req, res) => { await db.collection('songs').doc(req.params.id).delete(); res.send('Deleted'); });

// --- SETTINGS & LOGS ---
app.get('/api/settings', async (req, res) => {
    if(!db) return res.json({ headerTitle: 'FULLKIK', heroTitle: '专属DJ节奏空间', bannerUrl: '', activity: {enabled: false, reward: 10, count: 0, total: 0}, banners: [] });
    const doc = await db.collection('settings').doc('global').get(); res.json(doc.exists ? doc.data() : { headerTitle: 'FULLKIK', heroTitle: '专属DJ节奏空间', bannerUrl: '', activity: {enabled: false, reward: 10, count: 0, total: 0}, banners: [] });
});

app.put('/api/settings', async (req, res) => { 
    try {
        let updates = {};
        if (req.body.headerTitle !== undefined) updates.headerTitle = req.body.headerTitle;
        if (req.body.heroTitle !== undefined) updates.heroTitle = req.body.heroTitle;
        if (req.body.activity !== undefined) updates.activity = req.body.activity;
        
        if (req.body.banners !== undefined) {
            let processedBanners = [];
            for(let b of req.body.banners) {
                if(b && b.startsWith('data:image')) {
                    const url = await uploadToCloudinaryBase64(b, 'dj_banners');
                    processedBanners.push(url);
                } else if(b) { processedBanners.push(b); }
            }
            updates.banners = processedBanners;
        }

        await db.collection('settings').doc('global').set(updates, { merge: true }); 
        res.send('Updated'); 
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/logs/:type', async (req, res) => {
    try { const snap = await db.collection('logs').where('type', '==', req.params.type).get(); res.json(snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))); } catch(e) { res.json([]); }
});
app.post('/api/logs/delete', async (req, res) => { const batch = db.batch(); req.body.ids.forEach(id => batch.delete(db.collection('logs').doc(id))); await batch.commit(); res.send('ok'); });
app.delete('/api/logs/:type/all', async (req, res) => { const batch = db.batch(); (await db.collection('logs').where('type', '==', req.params.type).get()).docs.forEach(d => batch.delete(d.ref)); await batch.commit(); res.send('ok'); });

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server bound to 0.0.0.0 on Port ${PORT}`));
