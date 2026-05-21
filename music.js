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
    console.log('✅ Cloudinary Storage Connected!');
}

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

app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'music.html')); });

async function logEvent(type, message) { try { if(db) await db.collection('logs').add({ type, message, timestamp: new Date().toISOString() }); } catch(e) {} }

app.get('/api/stream/:songId', async (req, res) => {
    try {
        if(!db) return res.status(500).send('Database not connected');
        const isAudioTag = req.headers['sec-fetch-dest'] === 'audio' || req.headers['sec-fetch-dest'] === 'video';
        const referer = req.headers.referer || '';
        const isFromApp = referer.includes(req.get('host'));

        if (!isFromApp && !isAudioTag) {
            return res.status(403).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>403 - Forbidden</title><style>body { background-color: #0b0b13; background-image: radial-gradient(circle at 50% 0%, #1a1a3a 0%, #0b0b13 70%); color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; } .container { text-align: center; background: rgba(20, 20, 35, 0.8); padding: 50px 40px; border-radius: 24px; border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(30px); box-shadow: 0 20px 60px rgba(0,0,0,0.8); max-width: 320px; animation: popIn 0.5s cubic-bezier(0.16, 1, 0.3, 1); } @keyframes popIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } } .icon { width: 80px; height: 80px; fill: #ff453a; margin-bottom: 20px; filter: drop-shadow(0 0 10px rgba(255,69,58,0.5)); } h1 { font-size: 24px; margin: 0 0 10px 0; font-weight: 700; letter-spacing: -0.5px; } p { color: #a0a0b0; font-size: 15px; margin: 0 0 25px 0; line-height: 1.5; } .btn { background: #ff453a; color: white; text-decoration: none; padding: 12px 24px; border-radius: 12px; font-weight: 600; font-size: 15px; transition: 0.2s; display: inline-block; } .btn:hover { transform: scale(1.05); box-shadow: 0 5px 15px rgba(255,69,58,0.4); }</style></head><body><div class="container"><svg class="icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg><h1>403 Forbidden</h1><p>Direct linking is not allowed. Please play or download music directly through the platform.</p><a href="/" class="btn">Return to Portal</a></div></body></html>`);
        }

        const songDoc = await db.collection('songs').doc(req.params.songId).get();
        if (!songDoc.exists) return res.status(404).send('Song not found');
        const fileUrl = songDoc.data().filepath;

        const fetchHeaders = {}; if (req.headers.range) fetchHeaders.Range = req.headers.range;
        const response = await fetch(fileUrl, { headers: fetchHeaders });
        if (!response.ok) throw new Error('Cloudinary fetch failed');

        const contentType = response.headers.get('content-type'); const contentLength = response.headers.get('content-length'); const contentRange = response.headers.get('content-range'); const acceptRanges = response.headers.get('accept-ranges');
        if (contentType) res.setHeader('Content-Type', contentType); if (contentLength) res.setHeader('Content-Length', contentLength); if (contentRange) res.setHeader('Content-Range', contentRange); if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

        res.status(response.status); 
        Readable.fromWeb(response.body).pipe(res);
    } catch (e) { console.error('Stream Error:', e.message); res.status(500).end(); }
});

// --- AUTH & USERS ---
app.post('/api/register', async (req, res) => {
    try {
        if(!db) return res.status(500).send('DB disconnected');
        const { contact, username, password } = req.body;
        const userRef = db.collection('users').doc(username.toLowerCase());
        if ((await userRef.get()).exists) return res.status(400).send('USER HAS BEEN REGISTERED');
        if (!(await db.collection('users').where('contact', '==', contact).get()).empty) return res.status(400).send('USER HAS BEEN REGISTERED');
        const isEmail = contact.includes('@');
        await userRef.set({ username, contact, password, email: isEmail ? contact : '-', phone: isEmail ? '-' : contact, tokens: 0, profilePic: '', purchases: [], isVip: false, wechat: '', wechatPublic: false, createdAt: new Date().toISOString() });
        await logEvent('register', `<span style="color:#34c759; font-weight:600;">${username}</span> registered with ${contact}`);
        res.json({ success: true, username });
    } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/login', async (req, res) => {
    try {
        const { contact, password } = req.body;
        let uDoc = await db.collection('users').doc(contact.toLowerCase()).get();
        if (!uDoc.exists) { const q = await db.collection('users').where('contact', '==', contact).get(); if(!q.empty) uDoc = q.docs[0]; }
        if (uDoc && uDoc.data()?.password === password) res.json({ success: true, username: uDoc.data().username }); else res.status(400).send('Invalid credentials.');
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/users/:username', async (req, res) => {
    const doc = await db.collection('users').doc(req.params.username.toLowerCase()).get();
    if (doc.exists) res.json(doc.data()); else res.status(404).send('User not found');
});

app.get('/api/all-users', async (req, res) => { try { res.json((await db.collection('users').get()).docs.map(d => d.data())); } catch (e) { res.status(500).json([]); }});

app.put('/api/users/:username/vip', async (req, res) => {
    try {
        const { djName, wechat } = req.body;
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ isVip: true, djName: djName, wechat: wechat, wechatPublic: true });
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

app.put('/api/users/:username/change-email', async (req, res) => { await db.collection('users').doc(req.params.username.toLowerCase()).update({ email: req.body.newEmail }); res.send('Updated'); });
app.put('/api/users/:username/change-phone', async (req, res) => { await db.collection('users').doc(req.params.username.toLowerCase()).update({ phone: req.body.newPhone }); res.send('Updated'); });
app.put('/api/users/:username/set-tokens', async (req, res) => { await db.collection('users').doc(req.params.username.toLowerCase()).update({ tokens: parseInt(req.body.tokens) || 0 }); await logEvent('admin', `Modified token balance for <span style="font-weight:600;">${req.params.username}</span> to ${req.body.tokens}`); res.send('Updated'); });
app.delete('/api/users/:username', async (req, res) => { await db.collection('users').doc(req.params.username.toLowerCase()).delete(); await logEvent('admin', `Deleted user account: <span style="font-weight:600; color:var(--danger);">${req.params.username}</span>`); res.send('Deleted'); });
app.post('/api/users/:username/topup', async (req, res) => {
    const userRef = db.collection('users').doc(req.params.username.toLowerCase()); const doc = await userRef.get();
    const newTokens = (doc.data().tokens || 0) + req.body.amount; await userRef.update({ tokens: newTokens }); res.json({ tokens: newTokens });
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
            user.purchases.push({ songId: req.body.songId, songName: song.filename, filepath: song.filepath, coverUrl: song.coverUrl, tokensSpent: price, purchaseId, purchaseTime: new Date().toISOString() });
            
            await userRef.update({ tokens: user.tokens, purchases: user.purchases });
            await db.collection('songs').doc(req.body.songId).update({ downloads: admin.firestore.FieldValue.increment(1) });

            res.json({ success: true, tokens: user.tokens, purchases: user.purchases });
        } else res.status(400).send('Insufficient tokens');
    } catch (e) { res.status(500).send(e.message); }
});

// --- GENRES ---
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

// --- SONGS ---
app.get('/api/songs', async (req, res) => {
    try { res.json((await db.collection('songs').orderBy('sequence').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))); } catch(e) { res.status(500).json([]); }
});

async function saveSongData(fileBuffer, originalName, reqBody) {
    const audioResult = await uploadStreamToCloudinary(fileBuffer, "video", "dj_music");
    const url = audioResult.secure_url;
    let coverUrl = ''; if(reqBody.coverBase64) coverUrl = await uploadToCloudinaryBase64(reqBody.coverBase64, 'dj_covers');

    const snapshot = await db.collection('songs').get();
    const newSong = {
        filename: reqBody.title || originalName, filepath: url, coverUrl: coverUrl, genreId: reqBody.genreId || 'none',
        size: fileBuffer.length, uploadTime: new Date().toISOString(), sequence: snapshot.size + 1, price: parseInt(reqBody.price) || 10,
        downloads: 0, plays: 0, status: reqBody.status || 'APPROVED', uploader: reqBody.uploader || 'Admin'
    };
    const docRef = await db.collection('songs').add(newSong); return { id: docRef.id, ...newSong };
}

app.post('/api/upload', upload.single('mp3file'), async (req, res) => {
    try { if (!req.file) return res.status(400).send('No file.'); res.json(await saveSongData(req.file.buffer, req.file.originalname, req.body)); } 
    catch (e) { res.status(500).send(e.message); }
});

app.post('/api/transload', async (req, res) => {
    try {
        const response = await fetch(req.body.url); if (!response.ok) throw new Error(`HTTP Error from source URL`);
        const buffer = Buffer.from(await response.arrayBuffer());
        res.json(await saveSongData(buffer, 'TransloadedTrack.m4a', req.body));
    } catch (e) { res.status(400).send(e.message); }
});

app.put('/api/songs/:id/settings', async (req, res) => {
    try {
        let updates = {};
        if (req.body.newName) updates.filename = req.body.newName;
        if (req.body.newPrice !== undefined) updates.price = parseInt(req.body.newPrice) || 0;
        if (req.body.status) updates.status = req.body.status; 
        if (req.body.genreId) updates.genreId = req.body.genreId;
        if (req.body.coverBase64) updates.coverUrl = await uploadToCloudinaryBase64(req.body.coverBase64, 'dj_covers');
        await db.collection('songs').doc(req.params.id).update(updates); res.send('Updated');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/songs/reorder', async (req, res) => {
    const batch = db.batch(); req.body.orderedIds.forEach((id, index) => { batch.update(db.collection('songs').doc(id), { sequence: index + 1 }); }); await batch.commit(); res.send('Reordered');
});
app.delete('/api/songs/:id', async (req, res) => { await db.collection('songs').doc(req.params.id).delete(); res.send('Deleted'); });

// --- SETTINGS & LOGS ---
app.get('/api/settings', async (req, res) => {
    if(!db) return res.json({ headerTitle: 'FULKKIK', heroTitle: '专属DJ节奏空间', bannerUrl: '' });
    const doc = await db.collection('settings').doc('global').get(); res.json(doc.exists ? doc.data() : { headerTitle: 'FULKKIK', heroTitle: '专属DJ节奏空间', bannerUrl: '' });
});
app.put('/api/settings', async (req, res) => { await db.collection('settings').doc('global').set({ headerTitle: req.body.headerTitle, heroTitle: req.body.heroTitle }, { merge: true }); res.send('Updated'); });

app.get('/api/logs/:type', async (req, res) => {
    try { const snap = await db.collection('logs').where('type', '==', req.params.type).get(); res.json(snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))); } catch(e) { res.json([]); }
});
app.post('/api/logs/delete', async (req, res) => { const batch = db.batch(); req.body.ids.forEach(id => batch.delete(db.collection('logs').doc(id))); await batch.commit(); res.send('ok'); });
app.delete('/api/logs/:type/all', async (req, res) => { const batch = db.batch(); (await db.collection('logs').where('type', '==', req.params.type).get()).docs.forEach(d => batch.delete(d.ref)); await batch.commit(); res.send('ok'); });

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server bound to 0.0.0.0 on Port ${PORT}`));
