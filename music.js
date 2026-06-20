/**
 * ============================================================================
 * FULLKIK BACKEND ENGINE & API ROUTER
 * ============================================================================
 * Features: Authentication, Media Streaming, Anti-Theft Protection, 
 * Transactions, Genres, Playlists, Admin Management, Sensitive Words, Reports.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const admin = require('firebase-admin');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 80;

// ==========================================
// 1. MIDDLEWARE & CONFIGURATION
// ==========================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
function redirectWithQuery(target) {
    return (req, res) => {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(302, target + query);
    };
}
app.get('/music.html', redirectWithQuery('/fullkik/main.page'));
app.get('/profile.html', redirectWithQuery('/fullkik/profile.page'));
app.get('/manager.html', redirectWithQuery('/fullkik/manager.page'));
app.get('/register.html', redirectWithQuery('/fullkik/register'));
app.get('/vip.html', redirectWithQuery('/fullkik/vip'));
app.use(express.static(__dirname));

let db, bucket;
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    console.error("❌ FATAL ERROR: Missing FIREBASE_SERVICE_ACCOUNT_JSON!");
} else {
    try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
        admin.initializeApp({ 
            credential: admin.credential.cert(serviceAccount), 
            storageBucket: process.env.FIREBASE_STORAGE_BUCKET 
        });
        console.log('✅ Google Firebase Database Connected!');
        db = admin.firestore(); 
    } catch (error) { 
        console.error('❌ Firebase Error:', error.message); 
    }
}

if (process.env.CLOUDINARY_CLOUD_NAME) {
    cloudinary.config({ 
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
        api_key: process.env.CLOUDINARY_API_KEY, 
        api_secret: process.env.CLOUDINARY_API_SECRET 
    });
}

/**
 * Multer Memory Storage Configuration
 * Efficiently pipelines file uploads directly to Cloudinary without saving locally.
 */
const upload = multer({ 
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if(file.mimetype.includes('audio') || file.mimetype.includes('video') || file.mimetype.includes('image') || file.originalname.match(/\.(mp3|m4a|mp4|jpg|jpeg|png)$/i)) {
            cb(null, true); 
        } else {
            cb(new Error('Invalid file type.'));
        }
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
app.get('/', redirectWithQuery('/fullkik/main.page'));
app.get('/fullkik/main.page', (req, res) => { res.sendFile(path.join(__dirname, 'music.html')); });
app.get('/fullkik/profile.page', (req, res) => { res.sendFile(path.join(__dirname, 'profile.html')); });
app.get('/fullkik/manager.page', (req, res) => { res.sendFile(path.join(__dirname, 'manager.html')); });
app.get('/fullkik/register', (req, res) => { res.sendFile(path.join(__dirname, 'register.html')); });
app.get('/fullkik/vip', (req, res) => { res.sendFile(path.join(__dirname, 'vip.html')); });
app.get('/dj/:username/profile', (req, res) => { res.sendFile(path.join(__dirname, 'vip.html')); });
app.get('/producer/:username/profile', (req, res) => { res.sendFile(path.join(__dirname, 'vip.html')); });

async function logEvent(type, message) { 
    try { 
        if(db) await db.collection('logs').add({ type, message, timestamp: new Date().toISOString() }); 
    } catch(e) { console.error("Logging Error:", e); } 
}

const DEFAULT_SETTINGS = {
    headerTitle: 'FULLKIK',
    heroTitle: 'FULLKIK音乐空间',
    homeMainTitle: 'FULLKIK音乐空间',
    homeSubtitle: '专属DJ节奏空间 · 电音串烧 · 车载热播 · 精选原创作品',
    bannerUrl: '',
    activity: {enabled: false, reward: 10, count: 0, total: 0},
    banners: [],
    maxSongPrice: 200,
    supportWhatsapp: '',
    homePosterUrl: '',
    homeAnnouncement: '',
    defaultCoverUrl: '',
    featuredGenreIds: [],
    categoryDisplayGenreIds: [],
    topNavGenreIds: [],
    hotProducerIds: null,
    uploadSuccessMessage: '完成提交～ 请等待 1-3 天审核时间.',
    uploadSuccessDuration: 4,
    commissionStatement: '• 提钻最低额度为 1 钻石，提钻将收取 10% 的服务手续费。\n• 提钻申请后请联系 Gmail：fullkick@gmail.com，邮件内容请附上你的签名 / 联系方式。\n• 系统将进行 1-3 天审核处理。',
    contestActivities: [],
    coupons: [],
    topupExchangeRate: 1.7,
    topupPackages: [
        { id: 'PK500', label: '限时优惠', amount: 500, bonus: 200, firstTopupBonus: 0, rmPrice: 500, sort: 10, enabled: true },
        { id: 'PK400', label: '限时优惠', amount: 400, bonus: 150, firstTopupBonus: 0, rmPrice: 400, sort: 20, enabled: true },
        { id: 'PK300', label: '限时优惠', amount: 300, bonus: 100, firstTopupBonus: 0, rmPrice: 300, sort: 30, enabled: true },
        { id: 'PK200', label: '', amount: 200, bonus: 0, firstTopupBonus: 0, rmPrice: 200, sort: 40, enabled: true },
        { id: 'PK100', label: '', amount: 100, bonus: 0, firstTopupBonus: 0, rmPrice: 100, sort: 50, enabled: true },
        { id: 'PK50', label: '', amount: 50, bonus: 0, firstTopupBonus: 0, rmPrice: 50, sort: 60, enabled: true }
    ],
    referralConfig: { enabled: false, referrerReward: 10, newUserReward: 0 },
    referralRecords: []
};

async function getGlobalSettings() {
    if(!db) return { ...DEFAULT_SETTINGS };
    const doc = await db.collection('settings').doc('global').get();
    return doc.exists ? { ...DEFAULT_SETTINGS, ...doc.data() } : { ...DEFAULT_SETTINGS };
}

async function logAdminAction(message, meta = {}) {
    try {
        if(db) await db.collection('logs').add({
            type: 'admin',
            message,
            module: meta.module || '-',
            action: meta.action || '-',
            targetId: meta.targetId || '-',
            details: meta.details || message,
            adminName: meta.adminName || 'ADMIN',
            adminEmail: meta.adminEmail || 'admin@fullkik.local',
            timestamp: new Date().toISOString()
        });
    } catch(e) {
        console.error("Logging Error:", e);
    }
}

function createNotification(type, title, message, meta = {}) {
    return {
        id: 'NT' + Date.now() + Math.random().toString(36).substring(2, 7).toUpperCase(),
        type,
        title,
        message,
        meta,
        read: false,
        timestamp: new Date().toISOString()
    };
}

async function addUserNotification(username, notification) {
    try {
        if(!db || !username) return;
        const ref = db.collection('users').doc(String(username).toLowerCase());
        const doc = await ref.get();
        if(!doc.exists) return;
        const notifications = doc.data().notifications || [];
        notifications.unshift(notification);
        await ref.update({ notifications: notifications.slice(0, 100) });
    } catch(e) {
        console.error('Notification Error:', e.message);
    }
}

function normalizeReferralCode(value) {
    return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function normalizeSongName(value) {
    return String(value || '')
        .replace(/\.[^/.]+$/, '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function normalizeCouponCode(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function getCouponState(coupon, username, price, amount) {
    const now = Date.now();
    const code = normalizeCouponCode(coupon.code);
    const userKey = String(username || '').toLowerCase();
    const usedBy = Array.isArray(coupon.usedBy) ? coupon.usedBy : [];
    const maxUses = parseInt(coupon.maxUses);
    const minPrice = Math.max(parseFloat(coupon.minPrice) || 0, 0);
    const startAt = coupon.startAt ? new Date(coupon.startAt).getTime() : 0;
    const endAt = coupon.endAt ? new Date(coupon.endAt).getTime() : 0;
    if(!code) return { ok: false, reason: '优惠码无效' };
    if(coupon.status === 'DISABLED') return { ok: false, reason: '优惠码已停用' };
    if(startAt && now < startAt) return { ok: false, reason: '优惠码尚未生效' };
    if(endAt && now > endAt) return { ok: false, reason: '优惠码已过期' };
    if(minPrice && price < minPrice) return { ok: false, reason: `最低充值金额为 ${minPrice}` };
    if(maxUses && usedBy.length >= maxUses) return { ok: false, reason: '优惠码已用完' };
    if(usedBy.some(row => String(row.username || row).toLowerCase() === userKey)) return { ok: false, reason: '每位用户只能使用一次此优惠码' };

    const type = String(coupon.type || 'PERCENT').toUpperCase();
    const value = Math.max(parseFloat(coupon.value) || 0, 0);
    let finalPrice = price;
    let discount = 0;
    let bonusDiamonds = 0;
    if(type === 'PERCENT') {
        discount = Math.round(price * Math.min(value, 100) / 100);
        finalPrice = Math.max(0, price - discount);
    } else if(type === 'FIXED') {
        discount = Math.min(price, value);
        finalPrice = Math.max(0, price - discount);
    } else if(type === 'BONUS_DIAMONDS') {
        bonusDiamonds = Math.floor(value);
    }
    return {
        ok: true,
        code,
        coupon,
        type,
        value,
        baseAmount: amount,
        finalAmount: amount + bonusDiamonds,
        basePrice: price,
        finalPrice,
        discount,
        bonusDiamonds,
        description: coupon.description || ''
    };
}

async function validateCouponForUser(username, code, price, amount) {
    const settings = await getGlobalSettings();
    const coupons = Array.isArray(settings.coupons) ? settings.coupons : [];
    const coupon = coupons.find(c => normalizeCouponCode(c.code) === normalizeCouponCode(code));
    if(!coupon) return { ok: false, reason: '找不到优惠码' };
    return getCouponState(coupon, username, Math.max(parseFloat(price) || 0, 0), Math.max(parseInt(amount) || 0, 0));
}

function parseGenreIds(body = {}) {
    let ids = [];
    if(Array.isArray(body.genreIds)) ids = body.genreIds;
    else if(typeof body.genreIds === 'string') {
        try {
            const parsed = JSON.parse(body.genreIds);
            ids = Array.isArray(parsed) ? parsed : body.genreIds.split(',');
        } catch(e) {
            ids = body.genreIds.split(',');
        }
    }
    if(body.genreId) ids.unshift(body.genreId);
    return [...new Set(ids.map(id => String(id || '').trim()).filter(Boolean))];
}

async function notifyFollowersOfSong(songId, song) {
    try {
        if(!db || !song || !song.uploader || String(song.uploader).toUpperCase() === 'FULLKIK') return;
        const uploaderDoc = await db.collection('users').doc(String(song.uploader).toLowerCase()).get();
        if(!uploaderDoc.exists) return;
        const uploader = uploaderDoc.data();
        const followers = Array.isArray(uploader.followers) ? uploader.followers : [];
        const uploaderName = uploader.djName || uploader.username || song.uploader;
        await Promise.all(followers.map(follower => addUserNotification(follower, createNotification(
            'follow-song',
            `您关注的 ${uploaderName} 发布了新歌曲《${song.filename}》`,
            '',
            { songId, uploader: uploaderName }
        ))));
    } catch(e) {
        console.error('Follower Notify Error:', e.message);
    }
}

async function calculateUserEarnings(username) {
    const target = String(username || '').toLowerCase();
    const usersSnap = await db.collection('users').get();
    let total = 0;
    let favoriteCount = 0;
    usersSnap.docs.forEach(doc => {
        const user = doc.data();
        (user.purchases || []).forEach(p => {
            if(String(p.uploader || '').toLowerCase() === target) {
                total += parseInt(p.tokensSpent) || 0;
            }
        });
        (user.favorites || []).forEach(songId => {
            if(songId) favoriteCount += 0;
        });
    });

    const userDoc = await db.collection('users').doc(target).get();
    const withdrawals = userDoc.exists ? (userDoc.data().withdrawals || []) : [];
    const locked = withdrawals
        .filter(w => w.status !== 'REJECTED')
        .reduce((sum, w) => sum + (parseInt(w.amount) || 0), 0);

    return { total, locked, balance: Math.max(total - locked, 0), withdrawals };
}

async function collectWithdrawals() {
    const usersSnap = await db.collection('users').get();
    const rows = [];
    usersSnap.docs.forEach(doc => {
        const user = doc.data();
        (user.withdrawals || []).forEach(w => {
            rows.push({
                ...w,
                username: user.username || doc.id,
                email: user.email || user.contact || '-',
                phone: user.phone || '-',
                wechat: user.wechat || '-'
            });
        });
    });
    return rows.sort((a,b) => new Date(b.createdAt || b.completedAt || 0) - new Date(a.createdAt || a.completedAt || 0));
}

/**
 * Sensitive Word Checker Helper
 * Checks a given string against the active database of sensitive words.
 */
async function containsSensitiveWord(text) {
    try {
        if (!text) return false;
        const snap = await db.collection('sensitive_words').get();
        const sensitiveWords = snap.docs.map(d => d.data().word.toLowerCase());
        const lowerText = text.toLowerCase();
        for (let word of sensitiveWords) {
            if (lowerText.includes(word)) return true;
        }
        return false;
    } catch (e) {
        console.error("Sensitive Word Check Error:", e);
        return false;
    }
}

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    return String(forwarded || req.ip || req.socket?.remoteAddress || '')
        .replace(/^::ffff:/, '')
        .trim() || '-';
}

async function isIpBlocked(ip) {
    if(!db || !ip || ip === '-') return false;
    const snap = await db.collection('blocked_ips').where('ip', '==', ip).limit(1).get();
    return !snap.empty;
}

const STAFF_PERMISSIONS = [
    'upload_song',
    'bulk_upload',
    'view_all_songs',
    'edit_all_songs',
    'takedown_songs',
    'audit_songs',
    'manage_reports',
    'manage_categories',
    'manage_recommend',
    'manage_homepage',
    'manage_nav',
    'manage_banned_words',
    'manage_banned_ips',
    'manage_activity'
];

function generateStaffPassword() {
    return crypto.randomBytes(9).toString('base64url');
}

/**
 * Core Media Streaming Route
 * Prevents hotlinking and direct access outside of the platform.
 */
app.get('/api/stream/:songId', async (req, res) => {
    try {
        if(!db) return res.status(500).send('Database not connected');
        
        const isAudioTag = req.headers['sec-fetch-dest'] === 'audio' || req.headers['sec-fetch-dest'] === 'video';
        const referer = req.headers.referer || '';
        const isFromApp = referer.includes(req.get('host'));

        if (!isFromApp && !isAudioTag) {
            return res.status(403).send(`
                <!DOCTYPE html><html lang="en">
                <head>
                    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>403 - Forbidden</title>
                    <style>
                        body { background-color: #2b0a0a; color: #ff453a; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; } 
                        h1 { font-size: 36px; font-weight: 800; letter-spacing: 2px; text-shadow: 0 4px 15px rgba(0,0,0,0.5); }
                    </style>
                </head>
                <body><h1>禁止盗取歌曲</h1></body>
                </html>
            `);
        }

        const songDoc = await db.collection('songs').doc(req.params.songId).get();
        if (!songDoc.exists) return res.status(404).send('Song not found');
        
        const fetchHeaders = {}; 
        if (req.headers.range) fetchHeaders.Range = req.headers.range;
        
        const response = await fetch(songDoc.data().filepath, { headers: fetchHeaders });
        if (!response.ok) throw new Error('Cloudinary fetch failed');

        const contentType = response.headers.get('content-type'); 
        const contentLength = response.headers.get('content-length'); 
        const contentRange = response.headers.get('content-range'); 
        const acceptRanges = response.headers.get('accept-ranges');
        
        if (contentType) res.setHeader('Content-Type', contentType); 
        if (contentLength) res.setHeader('Content-Length', contentLength); 
        if (contentRange) res.setHeader('Content-Range', contentRange); 
        if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

        res.status(response.status); 
        Readable.fromWeb(response.body).pipe(res);
    } catch (e) { 
        console.error('Stream Error:', e.message); 
        res.status(500).end(); 
    }
});

// ==========================================
// 3. AUTHENTICATION & USER MANAGEMENT
// ==========================================
app.post('/api/otp/send', async (req, res) => {
    try {
        if(!db) return res.status(500).send('DB disconnected');
        const phone = String(req.body.phone || req.body.contact || '').trim();
        const type = String(req.body.type || 'register').trim() || 'register';
        if(!phone) return res.status(400).send('Contact required');
        const clientIp = getClientIp(req);
        if(type === 'register' && await isIpBlocked(clientIp)) {
            return res.status(403).send('此 IP 已被拉黑，无法注册');
        }
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
        const channel = req.body.channel || 'simulated';
        const ip = clientIp;
        const msgid = 'otp-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
        const ref = await db.collection('otp_logs').add({
            phone,
            code,
            type,
            channel,
            ip,
            userId: req.body.userId || '-',
            errors: 0,
            status: 'ACTIVE',
            msgid,
            timestamp: now.toISOString(),
            expiresAt,
            consumed: false
        });
        res.json({ success: true, otpId: ref.id, otp: code, expiresAt, msgid, simulated: true });
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/otp/verify', async (req, res) => {
    try {
        if(!db) return res.status(500).send('DB disconnected');
        const phone = String(req.body.phone || '').trim();
        const code = String(req.body.code || '').trim();
        const type = String(req.body.type || 'register').trim() || 'register';
        const snap = await db.collection('otp_logs').where('phone', '==', phone).where('type', '==', type).get();
        const rows = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const active = rows.find(row => !row.consumed && ['ACTIVE', 'VERIFIED'].includes(row.status));
        if(!active) return res.status(400).send('OTP 不存在或已过期');
        if(active.expiresAt && new Date(active.expiresAt).getTime() < Date.now()) {
            await active.ref.update({ status: 'EXPIRED' });
            return res.status(400).send('OTP 已过期');
        }
        if(active.code !== code) {
            await active.ref.update({ errors: (parseInt(active.errors) || 0) + 1 });
            return res.status(400).send('验证码错误');
        }
        await active.ref.update({ status: 'VERIFIED', verifiedAt: new Date().toISOString() });
        res.json({ success: true, otpToken: active.id });
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/otp-history', async (req, res) => {
    try {
        const snap = await db.collection('otp_logs').orderBy('timestamp', 'desc').limit(500).get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { res.json([]); }
});

app.post('/api/otp/resend/:id', async (req, res) => {
    try {
        const doc = await db.collection('otp_logs').doc(req.params.id).get();
        if(!doc.exists) return res.status(404).send('OTP not found');
        const data = doc.data();
        req.body.phone = data.phone;
        req.body.type = data.type || 'register';
        req.body.channel = data.channel || 'simulated';
        req.body.userId = data.userId || '-';
        const code = String(Math.floor(100000 + Math.random() * 900000));
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
        const msgid = 'otp-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
        const ref = await db.collection('otp_logs').add({
            phone: data.phone,
            code,
            type: data.type || 'register',
            channel: data.channel || 'simulated',
            ip: data.ip || '-',
            userId: data.userId || '-',
            errors: 0,
            status: 'ACTIVE',
            msgid,
            timestamp: now.toISOString(),
            expiresAt,
            consumed: false,
            resentFrom: req.params.id
        });
        res.json({ success: true, otpId: ref.id, otp: code, expiresAt, msgid, simulated: true });
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/register', async (req, res) => {
    try {
        if(!db) return res.status(500).send('DB disconnected');
        const { contact, username, password, otpToken } = req.body;
        const referredBy = normalizeReferralCode(req.body.ref || req.body.referrer || req.body.referredBy);
        if(!contact || !username || !password) return res.status(400).send('请填写所有字段');
        const clientIp = getClientIp(req);
        if(await isIpBlocked(clientIp)) return res.status(403).send('此 IP 已被拉黑，无法注册');
        const isEmail = String(contact).includes('@');
        
        // SENSITIVE WORD CHECK
        if (await containsSensitiveWord(username)) {
            return res.status(400).send('用户名包含敏感词，请修改。(Username contains sensitive words)');
        }

        const userRef = db.collection('users').doc(username.toLowerCase());
        if ((await userRef.get()).exists) return res.status(400).send('USER HAS BEEN REGISTERED');
        if (!(await db.collection('users').where('contact', '==', contact).get()).empty) return res.status(400).send('USER HAS BEEN REGISTERED');

        if(!otpToken) return res.status(400).send('请先完成 OTP 验证');
        const otpDoc = await db.collection('otp_logs').doc(String(otpToken)).get();
        if(!otpDoc.exists) return res.status(400).send('OTP 验证无效');
        const otpData = otpDoc.data();
        if(otpData.phone !== contact || otpData.type !== 'register' || otpData.status !== 'VERIFIED' || otpData.consumed) {
            return res.status(400).send('OTP 验证无效');
        }
        await otpDoc.ref.update({ status: 'USED', consumed: true, userId: username, consumedAt: new Date().toISOString() });
        
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

        const userData = { 
            username, contact, password, 
            email: isEmail ? contact : '-', phone: isEmail ? '-' : contact, 
            tokens: startTokens, profilePic: '', 
            purchases: [], topups: [], favorites: [], following: [], followers: [], playlists: [],
            notifications: [], withdrawals: [], loginHistory: [], referredBy: referredBy || '',
            role: 'NORMAL', isVip: false, wechat: '', wechatPublic: false, 
            status: 'ACTIVE', banReason: '', createdAt: new Date().toISOString() 
        };
        await userRef.set({ 
            ...userData
        });

        const settings = await getGlobalSettings();
        const refConfig = settings.referralConfig || DEFAULT_SETTINGS.referralConfig;
        if(refConfig.enabled && referredBy && referredBy !== username.toLowerCase()) {
            const referrerRef = db.collection('users').doc(referredBy);
            const referrerDoc = await referrerRef.get();
            if(referrerDoc.exists) {
                const referrer = referrerDoc.data();
                const reward = Math.max(parseInt(refConfig.referrerReward) || 10, 0);
                if(reward > 0) {
                    await referrerRef.update({ tokens: admin.firestore.FieldValue.increment(reward) });
                    await addUserNotification(referrer.username || referredBy, createNotification(
                        'referral',
                        `推荐人物获得 - ${reward}`,
                        `${username} 通过你的分享链接注册，奖励 ${reward} 钻石`,
                        { reward, newUser: username }
                    ));
                }
                const newUserReward = Math.max(parseInt(refConfig.newUserReward) || 0, 0);
                if(newUserReward > 0) {
                    await userRef.update({ tokens: admin.firestore.FieldValue.increment(newUserReward) });
                    await addUserNotification(username, createNotification(
                        'referral',
                        `推荐注册奖励 - ${newUserReward}`,
                        `你通过分享链接注册，获得 ${newUserReward} 钻石`,
                        { reward: newUserReward, referrer: referrer.username || referredBy }
                    ));
                }
                const record = {
                    id: 'RF' + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase(),
                    sharer: referrer.username || referredBy,
                    sharerEmail: referrer.email || referrer.contact || '-',
                    newUser: username,
                    newUserContact: contact,
                    reward,
                    timestamp: new Date().toISOString()
                };
                const records = Array.isArray(settings.referralRecords) ? settings.referralRecords : [];
                await db.collection('settings').doc('global').set({ referralRecords: [record, ...records].slice(0, 300) }, { merge: true });
            }
        }

        await logEvent('register', `<span style="color:#34c759; font-weight:600;">${username}</span> registered with ${contact} (Received ${startTokens}💎)`);
        res.json({ success: true, username });
    } catch (e) { 
        res.status(500).send(e.message); 
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { contact, password } = req.body;
        let uDoc = await db.collection('users').doc(contact.toLowerCase()).get();
        if (!uDoc.exists) { 
            const q = await db.collection('users').where('contact', '==', contact).get(); 
            if(!q.empty) uDoc = q.docs[0]; 
        }
        if (!uDoc || !uDoc.exists) return res.status(400).send('Invalid credentials.');
        
        if (uDoc.data().status === 'BANNED') return res.status(403).send(`Account Banned: ${uDoc.data().banReason || 'Violation of terms'}`);
        if (uDoc.data().password === password) {
            const userData = uDoc.data();
            const ip = getClientIp(req);
            const device = req.get('user-agent') || '-';
            const loginHistory = [
                { time: new Date().toISOString(), ip, device },
                ...((userData.loginHistory || []).filter(Boolean))
            ].slice(0, 20);
            await uDoc.ref.update({ loginHistory });
            res.json({ success: true, username: userData.username }); 
        }
        else res.status(400).send('Invalid credentials.');
    } catch (e) { 
        res.status(500).send(e.message); 
    }
});

app.get('/api/users/:username', async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.params.username.toLowerCase()).get();
        if (doc.exists) {
            if(doc.data().status === 'BANNED') return res.status(404).send('Banned');
            let data = doc.data(); 
            delete data.password;
            if(!data.playlists) data.playlists = [];
            if(!data.notifications) data.notifications = [];
            if(!data.withdrawals) data.withdrawals = [];
            if(!data.loginHistory) data.loginHistory = [];
            res.json(data);
        } else res.status(404).send('User not found');
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.get('/api/all-users', async (req, res) => { 
    try { 
        const users = (await db.collection('users').get()).docs.map(d => {
            let data = d.data(); 
            delete data.password; 
            if(!data.playlists) data.playlists = [];
            if(!data.notifications) data.notifications = [];
            if(!data.withdrawals) data.withdrawals = [];
            if(!data.loginHistory) data.loginHistory = [];
            return data;
        });
        res.json(users); 
    } catch (e) { 
        res.status(500).json([]); 
    }
});

app.put('/api/users/:username/change-username', async (req, res) => {
    try {
        const oldId = req.params.username.toLowerCase(), newId = req.body.newUsername.toLowerCase();
        
        // SENSITIVE WORD CHECK
        if (await containsSensitiveWord(req.body.newUsername)) {
            return res.status(400).send('包含敏感词 (Contains sensitive word)');
        }

        if ((await db.collection('users').doc(newId).get()).exists) return res.status(400).send('Username taken.');
        const oldRef = db.collection('users').doc(oldId); 
        const doc = await oldRef.get();
        const data = doc.data(); data.username = req.body.newUsername; 
        await db.collection('users').doc(newId).set(data); 
        await oldRef.delete();
        res.json({ success: true, username: req.body.newUsername });
    } catch (e) { 
        res.status(500).send(e.message); 
    }
});

app.post('/api/users/:username/follow', async (req, res) => {
    try {
        const { targetUser } = req.body;
        if(!targetUser || targetUser.toLowerCase() === req.params.username.toLowerCase()) return res.status(400).send('Invalid target');
        
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const targetRef = db.collection('users').doc(targetUser.toLowerCase());
        
        const userDoc = await userRef.get(); const targetDoc = await targetRef.get();
        if(!userDoc.exists || !targetDoc.exists) return res.status(404).send('User not found');

        let following = userDoc.data().following || [];
        let followers = targetDoc.data().followers || [];

        if(following.includes(targetUser)) {
            following = following.filter(u => u !== targetUser);
            followers = followers.filter(u => u !== userDoc.data().username);
        } else {
            following.push(targetUser);
            followers.push(userDoc.data().username);
        }

        await userRef.update({ following }); await targetRef.update({ followers });
        res.json({ success: true, following });
    } catch (e) { 
        res.status(500).send(e.message); 
    }
});

// ==========================================
// 4. PLAYLISTS SYSTEM
// ==========================================
app.post('/api/users/:username/playlists', async (req, res) => {
    try {
        const { name, songIds } = req.body;
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if(!doc.exists) return res.status(404).send("User not found");

        let playlists = doc.data().playlists || [];
        const newPlaylist = {
            id: 'PL' + Date.now() + Math.random().toString(36).substring(2,7),
            name: name || 'New Playlist',
            songs: songIds || [],
            createdAt: new Date().toISOString()
        };
        
        playlists.push(newPlaylist);
        await userRef.update({ playlists });
        res.json({ success: true, playlists });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.put('/api/users/:username/playlists/:playlistId', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if(!doc.exists) return res.status(404).send("User not found");

        let playlists = doc.data().playlists || [];
        const index = playlists.findIndex(p => p.id === req.params.playlistId);
        if(index === -1) return res.status(404).send("Playlist not found");

        if(req.body.name !== undefined) playlists[index].name = req.body.name;
        if(req.body.songs !== undefined) playlists[index].songs = req.body.songs;

        await userRef.update({ playlists });
        res.json({ success: true, playlists });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

app.delete('/api/users/:username/playlists/:playlistId', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if(!doc.exists) return res.status(404).send("User not found");

        let playlists = doc.data().playlists || [];
        playlists = playlists.filter(p => p.id !== req.params.playlistId);

        await userRef.update({ playlists });
        res.json({ success: true, playlists });
    } catch (e) {
        res.status(500).send(e.message);
    }
});

// ==========================================
// 5. FAVORITES, TOPUPS & PURCHASES
// ==========================================
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

app.get('/api/users/:username/notifications', async (req, res) => {
    try {
        const doc = await db.collection('users').doc(req.params.username.toLowerCase()).get();
        if(!doc.exists) return res.status(404).send('User not found');
        res.json((doc.data().notifications || []).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)));
    } catch(e) { res.status(500).json([]); }
});

app.put('/api/users/:username/notifications/read', async (req, res) => {
    try {
        const ref = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await ref.get();
        if(!doc.exists) return res.status(404).send('User not found');
        const notifications = (doc.data().notifications || []).map(n => ({ ...n, read: true }));
        await ref.update({ notifications });
        res.json({ success: true, notifications });
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/users/:username/withdrawals', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if(!doc.exists) return res.status(404).send('User not found');
        const earnings = await calculateUserEarnings(req.params.username);
        res.json({
            totalEarned: earnings.total,
            locked: earnings.locked,
            balance: earnings.balance,
            withdrawals: earnings.withdrawals.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))
        });
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/users/:username/withdrawals', async (req, res) => {
    try {
        const amount = parseInt(req.body.amount);
        if(Number.isNaN(amount) || amount < 1) return res.status(400).send('Amount must be at least 1');

        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if(!doc.exists) return res.status(404).send('User not found');

        const earnings = await calculateUserEarnings(req.params.username);
        if(amount > earnings.balance) return res.status(400).send('Amount exceeds available balance');

        const user = doc.data();
        const withdrawals = user.withdrawals || [];
        const record = {
            id: 'WD' + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase(),
            amount,
            currency: 'RM',
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            note: req.body.note || ''
        };
        withdrawals.unshift(record);
        await userRef.update({ withdrawals });
        await addUserNotification(req.params.username, createNotification('withdrawal', '提现申请已提交', `已提交 ${amount} 钻石，等待审核`, { amount }));
        res.json({ success: true, withdrawal: record, balance: earnings.balance - amount, withdrawals });
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/coupons', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        res.json(Array.isArray(settings.coupons) ? settings.coupons : []);
    } catch(e) { res.json([]); }
});

app.post('/api/coupons/validate', async (req, res) => {
    try {
        const result = await validateCouponForUser(req.body.username, req.body.code, req.body.price, req.body.amount);
        if(!result.ok) return res.status(400).send(result.reason);
        res.json(result);
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/coupons', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const coupons = Array.isArray(settings.coupons) ? settings.coupons : [];
        const code = normalizeCouponCode(req.body.code);
        if(!code) return res.status(400).send('Code required');
        if(coupons.some(c => normalizeCouponCode(c.code) === code)) return res.status(400).send('优惠码已存在');
        const coupon = {
            id: 'CP' + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase(),
            code,
            description: String(req.body.description || '').trim(),
            type: String(req.body.type || 'PERCENT').toUpperCase(),
            value: Math.max(parseFloat(req.body.value) || 0, 0),
            minPrice: Math.max(parseFloat(req.body.minPrice) || 0, 0),
            maxUses: Math.max(parseInt(req.body.maxUses) || 0, 0),
            startAt: req.body.startAt || '',
            endAt: req.body.endAt || '',
            status: 'ACTIVE',
            usedBy: [],
            createdAt: new Date().toISOString()
        };
        await db.collection('settings').doc('global').set({ coupons: [coupon, ...coupons].slice(0, 200) }, { merge: true });
        await logAdminAction(`Created coupon ${code}`, { module: '财务', action: '创建优惠码', targetId: code, details: JSON.stringify(coupon) });
        res.json(coupon);
    } catch(e) { res.status(500).send(e.message); }
});

app.delete('/api/coupons/:code', async (req, res) => {
    try {
        const settings = await getGlobalSettings();
        const code = normalizeCouponCode(req.params.code);
        const coupons = (Array.isArray(settings.coupons) ? settings.coupons : []).filter(c => normalizeCouponCode(c.code) !== code);
        await db.collection('settings').doc('global').set({ coupons }, { merge: true });
        await logAdminAction(`Deleted coupon ${code}`, { module: '财务', action: '删除优惠码', targetId: code, details: 'Delete coupon' });
        res.send('Deleted');
    } catch(e) { res.status(500).send(e.message); }
});

app.post('/api/users/:username/topup', async (req, res) => {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase()); const doc = await userRef.get();
        const user = doc.data();
        let topupAmount = parseInt(req.body.amount) || 0;
        let finalPrice = Math.max(parseFloat(req.body.price) || 0, 0);
        let couponMeta = null;
        const couponCode = normalizeCouponCode(req.body.couponCode);
        if(couponCode) {
            const validation = await validateCouponForUser(req.params.username, couponCode, finalPrice, topupAmount);
            if(!validation.ok) return res.status(400).send(validation.reason);
            topupAmount = validation.finalAmount;
            finalPrice = validation.finalPrice;
            couponMeta = {
                code: validation.code,
                type: validation.type,
                discount: validation.discount,
                bonusDiamonds: validation.bonusDiamonds,
                description: validation.description
            };
            const settings = await getGlobalSettings();
            const coupons = (Array.isArray(settings.coupons) ? settings.coupons : []).map(c => {
                if(normalizeCouponCode(c.code) !== couponCode) return c;
                const usedBy = Array.isArray(c.usedBy) ? c.usedBy : [];
                return { ...c, usedBy: [{ username: req.params.username, time: new Date().toISOString() }, ...usedBy], lastUsedAt: new Date().toISOString() };
            });
            await db.collection('settings').doc('global').set({ coupons }, { merge: true });
        }
        const newTokens = (user.tokens || 0) + topupAmount; 
        const topups = user.topups || [];
        const orderId = 'TP' + Date.now() + Math.random().toString(36).substring(2,7).toUpperCase();
        topups.push({ amount: topupAmount, price: finalPrice, originalPrice: req.body.price || 0, currency: req.body.currency || 'RMB', coupon: couponMeta, date: new Date().toISOString() });
        
        await userRef.update({ tokens: newTokens, topups: topups }); 
        await addUserNotification(req.params.username, createNotification(
            'topup',
            `成功充值 - ${topupAmount}`,
            `充值 ${req.body.currency || 'RMB'} ${finalPrice}，获得 ${topupAmount} 钻石`,
            { amount: topupAmount, price: finalPrice, currency: req.body.currency || 'RMB', coupon: couponMeta }
        ));
        
        await db.collection('orders').add({
            user: req.params.username, email: user.email || '-',
            orderId: orderId, amount: topupAmount, price: finalPrice, originalPrice: req.body.price || 0, currency: req.body.currency || 'RMB', coupon: couponMeta,
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
            if(song.uploader && String(song.uploader).toUpperCase() !== 'FULLKIK') {
                await addUserNotification(song.uploader, createNotification(
                    'sale',
                    `歌曲售出 - ${song.filename}`,
                    `${req.params.username} 购买了你的歌曲，累计收入增加 ${price} 钻石`,
                    { songId: req.body.songId, buyer: req.params.username, amount: price }
                ));
            }

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
// 6. ADMIN USER MANAGEMENT & LOGS
// ==========================================
app.put('/api/admin/users/:username/role', async (req, res) => {
    try {
        const requestedRole = req.body.role || (req.body.isVip ? 'VIP' : 'NORMAL');
        const allowedRoles = ['NORMAL', 'VIP', 'PRODUCER'];
        if (!allowedRoles.includes(requestedRole)) return res.status(400).send('Invalid role');

        await db.collection('users').doc(req.params.username.toLowerCase()).update({ 
            isVip: requestedRole === 'VIP' || requestedRole === 'PRODUCER', 
            role: requestedRole 
        });
        await logAdminAction(`Updated role for ${req.params.username} to ${requestedRole}`, {
            module: '用户',
            action: '设置角色',
            targetId: req.params.username,
            details: `设置 user ${req.params.username} to ${requestedRole}`
        });
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
        await logAdminAction(`Adjusted tokens for ${req.params.username} by ${amt > 0 ? '+'+amt : amt}. Reason: ${req.body.reason}`, {
            module: '用户',
            action: '调整钻石',
            targetId: req.params.username,
            details: `Adjust usercredit ${amt > 0 ? '+'+amt : amt}. Reason: ${req.body.reason || '-'}`
        });
        res.send('Adjusted');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/force-password', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ password: req.body.newPassword });
        await logAdminAction(`Forced password reset for ${req.params.username}`, {
            module: '用户',
            action: '重置密码',
            targetId: req.params.username,
            details: 'Forced password reset'
        });
        res.send('Reset');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/ban', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ status: 'BANNED', banReason: req.body.reason });
        await logAdminAction(`Banned user <span style="color:var(--danger)">${req.params.username}</span>. Reason: ${req.body.reason}`, {
            module: '用户',
            action: '封禁用户',
            targetId: req.params.username,
            details: `Banned user. Reason: ${req.body.reason || '-'}`
        });
        res.send('Banned');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/users/:username/unban', async (req, res) => {
    try {
        await db.collection('users').doc(req.params.username.toLowerCase()).update({ status: 'ACTIVE', banReason: '' });
        await logAdminAction(`Unbanned user <span style="color:var(--success)">${req.params.username}</span>.`, {
            module: '用户',
            action: '解封用户',
            targetId: req.params.username,
            details: 'Unban user'
        });
        res.send('Unbanned');
    } catch(e) { res.status(500).send(e.message); }
});

async function deleteUserAccount(req, res) {
    try {
        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const userDoc = await userRef.get();
        if (!userDoc.exists) return res.status(404).send('User not found');

        const deletedUser = userDoc.data();
        const deletedUsername = deletedUser.username || req.params.username;
        const uploaderNames = [req.params.username, deletedUser.username, deletedUser.djName]
            .filter(Boolean)
            .map(name => String(name).toLowerCase());
        const songSnap = await db.collection('songs').get();
        const songsToDelete = songSnap.docs.filter(doc => uploaderNames.includes(String(doc.data().uploader || '').toLowerCase()));
        for(let i = 0; i < songsToDelete.length; i += 450) {
            const batch = db.batch();
            songsToDelete.slice(i, i + 450).forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }

        await userRef.delete(); 
        await logAdminAction(`Deleted user account: <span style="color:var(--danger);">${deletedUsername}</span>`, {
            module: '用户',
            action: '删除用户',
            targetId: deletedUsername,
            details: `Delete User | Removed uploaded songs: ${songsToDelete.length}`
        }); 
        res.send(`Deleted. Removed uploaded songs: ${songsToDelete.length}`); 
    } catch(e) { res.status(500).send(e.message); }
}

app.delete('/api/admin/users/:username', deleteUserAccount);
app.delete('/api/users/:username', deleteUserAccount);

app.put('/api/admin/users/:username/profile', async (req, res) => {
    try {
        const oldId = req.params.username.toLowerCase();
        const userRef = db.collection('users').doc(oldId);
        const snap = await userRef.get();
        if(!snap.exists) return res.status(404).send('User not found');

        const current = snap.data();
        const nextUsername = String(req.body.username || current.username || req.params.username).trim();
        if(!nextUsername) return res.status(400).send('Username required');
        if(await containsSensitiveWord(nextUsername)) return res.status(400).send('包含敏感词 (Contains sensitive word)');

        const newId = nextUsername.toLowerCase();
        if(newId !== oldId && (await db.collection('users').doc(newId).get()).exists) {
            return res.status(400).send('Username taken.');
        }

        const updates = {
            username: nextUsername,
            email: req.body.email !== undefined ? String(req.body.email || '').trim() : (current.email || '-'),
            phone: req.body.phone !== undefined ? String(req.body.phone || '').trim() : (current.phone || '-'),
            wechat: req.body.wechat !== undefined ? String(req.body.wechat || '').trim() : (current.wechat || '')
        };

        const changes = [];
        if((current.username || '') !== updates.username) changes.push(`username: ${current.username || '-'} -> ${updates.username}`);
        if((current.email || '') !== updates.email) changes.push(`gmail: ${current.email || '-'} -> ${updates.email || '-'}`);
        if((current.phone || '') !== updates.phone) changes.push(`phone: ${current.phone || '-'} -> ${updates.phone || '-'}`);
        if((current.wechat || '') !== updates.wechat) changes.push(`wechat: ${current.wechat || '-'} -> ${updates.wechat || '-'}`);

        if(newId !== oldId) {
            await db.collection('users').doc(newId).set({ ...current, ...updates });
            await userRef.delete();
        } else {
            await userRef.update(updates);
        }

        if(changes.length) {
            await logAdminAction(`Adjusted user profile for ${updates.username}`, {
                module: '用户',
                action: '调整资料',
                targetId: updates.username,
                details: changes.join(' | ')
            });
        }

        res.json({ success: true, username: updates.username });
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/users/:username/vip', async (req, res) => {
    try {
        const { djName, wechat } = req.body;
        
        // Check Sensitive Words
        if (await containsSensitiveWord(djName)) {
            return res.status(400).send('包含敏感词 (Contains sensitive word)');
        }

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

// ==========================================
// 7. REPORTS & SENSITIVE WORDS (ADMIN)
// ==========================================
app.get('/api/sensitive-words', async (req, res) => {
    try {
        const snap = await db.collection('sensitive_words').orderBy('timestamp', 'desc').get();
        res.json(snap.docs.map(d => ({id: d.id, ...d.data()})));
    } catch(e) { res.status(500).json([]); }
});

app.post('/api/sensitive-words', async (req, res) => {
    try {
        const word = (req.body.word || '').trim().toLowerCase();
        if(!word) return res.status(400).send('Word required');
        const existing = await db.collection('sensitive_words').where('word', '==', word).limit(1).get();
        if(!existing.empty) return res.status(400).send('Word already exists');

        const newWord = { word, status: 'ACTIVE', timestamp: new Date().toISOString() };
        const docRef = await db.collection('sensitive_words').add(newWord);
        res.json({ id: docRef.id, ...newWord });
    } catch(e) { res.status(500).send(e.message); }
});

app.delete('/api/sensitive-words/:id', async (req, res) => {
    try {
        await db.collection('sensitive_words').doc(req.params.id).delete();
        res.send('Deleted');
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/blocked-ips', async (req, res) => {
    try {
        const snap = await db.collection('blocked_ips').orderBy('timestamp', 'desc').get();
        res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch(e) { res.status(500).json([]); }
});

app.post('/api/blocked-ips', async (req, res) => {
    try {
        const ip = String(req.body.ip || '').trim().replace(/^::ffff:/, '');
        const note = String(req.body.note || '').trim().slice(0, 200);
        const validIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) && ip.split('.').every(part => Number(part) >= 0 && Number(part) <= 255);
        if(!validIpv4) return res.status(400).send('请输入完整 IPv4 地址');
        const existing = await db.collection('blocked_ips').where('ip', '==', ip).limit(1).get();
        if(!existing.empty) return res.status(400).send('此 IP 已在拉黑列表');
        const row = {
            ip,
            note,
            blockedBy: String(req.body.blockedBy || 'ADMIN').trim() || 'ADMIN',
            timestamp: new Date().toISOString()
        };
        const ref = await db.collection('blocked_ips').add(row);
        await logAdminAction(`Blocked IP ${ip}`, { module: '内容', action: 'IP 拉黑', targetId: ip, details: note || 'No note' });
        res.json({ id: ref.id, ...row });
    } catch(e) { res.status(500).send(e.message); }
});

app.delete('/api/blocked-ips/:id', async (req, res) => {
    try {
        const ref = db.collection('blocked_ips').doc(req.params.id);
        const doc = await ref.get();
        if(!doc.exists) return res.status(404).send('IP not found');
        await ref.delete();
        await logAdminAction(`Unblocked IP ${doc.data().ip}`, { module: '内容', action: '解除 IP 拉黑', targetId: doc.data().ip });
        res.send('Deleted');
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/admin/staff', async (req, res) => {
    try {
        const snap = await db.collection('admin_staff').orderBy('createdAt', 'desc').get();
        const staff = snap.docs.map(d => {
            const data = d.data();
            delete data.password;
            return { id: d.id, ...data };
        });
        res.json(staff);
    } catch(e) { res.status(500).json([]); }
});

app.post('/api/admin/staff', async (req, res) => {
    try {
        const email = String(req.body.email || '').trim().toLowerCase();
        const username = String(req.body.username || '').trim();
        const permissions = Array.isArray(req.body.permissions)
            ? req.body.permissions.filter(p => STAFF_PERMISSIONS.includes(p))
            : [];
        if(!email && !username) return res.status(400).send('邮箱与显示名至少填写一项');
        if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).send('邮箱格式不正确');
        if(email) {
            const duplicate = await db.collection('admin_staff').where('email', '==', email).limit(1).get();
            if(!duplicate.empty) return res.status(400).send('此邮箱已存在');
        }
        const password = generateStaffPassword();
        const now = new Date().toISOString();
        const row = {
            username: username || email.split('@')[0],
            email: email || `staff-${Date.now().toString(36)}@fullkik.local`,
            password,
            role: 'MAINTAINER',
            status: 'ACTIVE',
            permissions,
            createdAt: now,
            lastLoginAt: ''
        };
        const ref = await db.collection('admin_staff').add(row);
        await logAdminAction(`Created staff ${row.username}`, { module: '用户', action: '新建员工账号', targetId: ref.id, details: `${row.email} | ${permissions.length} permissions` });
        res.json({ id: ref.id, ...row });
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/admin/staff/:id/permissions', async (req, res) => {
    try {
        const permissions = Array.isArray(req.body.permissions)
            ? req.body.permissions.filter(p => STAFF_PERMISSIONS.includes(p))
            : [];
        await db.collection('admin_staff').doc(req.params.id).update({ permissions, updatedAt: new Date().toISOString() });
        await logAdminAction(`Updated staff permissions ${req.params.id}`, { module: '用户', action: '保存员工权限', targetId: req.params.id, details: permissions.join(', ') });
        res.json({ permissions });
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/admin/staff/:id/password', async (req, res) => {
    try {
        const doc = await db.collection('admin_staff').doc(req.params.id).get();
        if(!doc.exists) return res.status(404).send('Staff not found');
        res.json({ password: doc.data().password || '' });
    } catch(e) { res.status(500).send(e.message); }
});

app.delete('/api/admin/staff/:id', async (req, res) => {
    try {
        const ref = db.collection('admin_staff').doc(req.params.id);
        const doc = await ref.get();
        if(!doc.exists) return res.status(404).send('Staff not found');
        await ref.delete();
        await logAdminAction(`Deleted staff ${doc.data().username || req.params.id}`, { module: '用户', action: '删除员工账号', targetId: req.params.id });
        res.send('Deleted');
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/reports', async (req, res) => {
    try {
        const snap = await db.collection('reports').orderBy('timestamp', 'desc').get();
        res.json(snap.docs.map(d => ({id: d.id, ...d.data()})));
    } catch(e) { res.status(500).json([]); }
});

app.post('/api/reports', async (req, res) => {
    try {
        const allowedReasons = ['版权', '其他'];
        const reportReason = allowedReasons.includes(req.body.reason) ? req.body.reason : '其他';
        const newReport = {
            songId: req.body.songId,
            songName: req.body.songName,
            uploader: req.body.uploader,
            reporter: req.body.reporter || 'Guest',
            reason: reportReason,
            description: req.body.description || '-',
            status: 'PENDING',
            timestamp: new Date().toISOString()
        };
        const docRef = await db.collection('reports').add(newReport);
        res.json({ id: docRef.id, ...newReport });
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/reports/:id/dismiss', async (req, res) => {
    try {
        await db.collection('reports').doc(req.params.id).delete();
        res.send('Dismissed and deleted');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/reports/:id/unlist', async (req, res) => {
    try {
        const reportRef = db.collection('reports').doc(req.params.id);
        const reportDoc = await reportRef.get();
        if(reportDoc.exists) {
            const songId = reportDoc.data().songId;
            if(songId) {
                await db.collection('songs').doc(songId).update({ status: 'UNLISTED' });
            }
            await reportRef.delete();
            await logAdminAction(`Unlisted reported song: <span style="color:var(--danger)">${reportDoc.data().songName || songId}</span>`, {
                module: '歌曲',
                action: '举报下架',
                targetId: songId,
                details: `Report unlisted: ${reportDoc.data().songName || songId}`
            });
        }
        res.send('Unlisted and report deleted');
    } catch(e) { res.status(500).send(e.message); }
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

app.delete('/api/finance/reconcile', async (req, res) => {
    try {
        let deleted = 0;
        for (const name of ['orders', 'transactions']) {
            const snap = await db.collection(name).get();
            for(let i = 0; i < snap.docs.length; i += 450) {
                const batch = db.batch();
                snap.docs.slice(i, i + 450).forEach(doc => {
                    batch.delete(doc.ref);
                    deleted++;
                });
                await batch.commit();
            }
        }
        await logAdminAction('Cleared finance reconciliation records', {
            module: '财务',
            action: '清除对账',
            targetId: 'finance',
            details: `Deleted orders and transactions: ${deleted}`
        });
        res.json({ success: true, deleted });
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/withdrawals', async (req, res) => {
    try { res.json(await collectWithdrawals()); } catch(e) { res.status(500).json([]); }
});

app.put('/api/withdrawals/:username/:withdrawalId/status', async (req, res) => {
    try {
        const nextStatus = String(req.body.status || '').toUpperCase();
        const allowed = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED'];
        if(!allowed.includes(nextStatus)) return res.status(400).send('Invalid status');

        const userRef = db.collection('users').doc(req.params.username.toLowerCase());
        const doc = await userRef.get();
        if(!doc.exists) return res.status(404).send('User not found');

        const user = doc.data();
        const withdrawals = user.withdrawals || [];
        const index = withdrawals.findIndex(w => w.id === req.params.withdrawalId);
        if(index === -1) return res.status(404).send('Withdrawal not found');

        withdrawals[index] = {
            ...withdrawals[index],
            status: nextStatus,
            adminNote: req.body.adminNote || withdrawals[index].adminNote || '',
            updatedAt: new Date().toISOString(),
            completedAt: ['COMPLETED', 'REJECTED'].includes(nextStatus) ? new Date().toISOString() : withdrawals[index].completedAt || ''
        };

        await userRef.update({ withdrawals });
        const notificationTitle = nextStatus === 'REJECTED'
            ? '退款消息 - 提现被拒绝'
            : nextStatus === 'COMPLETED'
                ? '提现已完成'
                : `提现状态更新 - ${nextStatus}`;
        await addUserNotification(user.username || req.params.username, createNotification(
            'withdrawal',
            notificationTitle,
            `提现 ${withdrawals[index].amount} 钻石状态更新为 ${nextStatus}${withdrawals[index].adminNote ? `：${withdrawals[index].adminNote}` : ''}`,
            { withdrawalId: req.params.withdrawalId, status: nextStatus, amount: withdrawals[index].amount }
        ));
        await logAdminAction(`Withdrawal ${nextStatus}: ${user.username || req.params.username}`, {
            module: '财务',
            action: '提现审批',
            targetId: req.params.withdrawalId,
            details: `${user.username || req.params.username} | ${withdrawals[index].amount} | ${nextStatus}`
        });
        res.json({ success: true, withdrawal: withdrawals[index] });
    } catch(e) { res.status(500).send(e.message); }
});

// ==========================================
// 8. GENRES AND SONGS
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
    const settings = await getGlobalSettings();
    const price = parseInt(reqBody.price) || 0;
    const maxSongPrice = parseInt(settings.maxSongPrice) || 200;
    const uploader = reqBody.uploader || 'FULLKIK';
    const isVipUpload = reqBody.status === 'PENDING' || (uploader && !String(uploader).toUpperCase().startsWith('FULLKIK'));
    const title = reqBody.title || originalName;
    const genreIds = parseGenreIds(reqBody);

    if(isVipUpload && price > maxSongPrice) {
        throw new Error(`歌曲钻石价格不能超过 ${maxSongPrice}`);
    }

    const snapshot = await db.collection('songs').get();
    const normalizedTitle = normalizeSongName(title);
    const normalizedOriginal = normalizeSongName(originalName);
    const incomingSize = fileBuffer ? fileBuffer.length : 0;
    const incomingUrl = String(reqBody.url || '').trim();
    const duplicateDoc = snapshot.docs.find(doc => {
        const song = doc.data();
        const existingTitle = normalizeSongName(song.filename);
        const existingOriginal = normalizeSongName(song.originalName || song.filename);
        const sameTitle = normalizedTitle && existingTitle === normalizedTitle;
        const sameFile = incomingSize && parseInt(song.size) === incomingSize && existingOriginal === normalizedOriginal;
        const sameUrl = incomingUrl && song.filepath === incomingUrl;
        return sameTitle || sameFile || sameUrl;
    });
    if(duplicateDoc) {
        const err = new Error('此歌曲已存在');
        err.status = 409;
        throw err;
    }

    let url = '';
    if(fileBuffer) {
        const audioResult = await uploadStreamToCloudinary(fileBuffer, "video", "dj_music");
        url = audioResult.secure_url;
    } else if(reqBody.url) {
        url = reqBody.url;
    }

    let coverUrl = settings.defaultCoverUrl || DEFAULT_COVER; 
    if(reqBody.coverBase64 && !reqBody.coverBase64.includes('<svg')) {
        coverUrl = await uploadToCloudinaryBase64(reqBody.coverBase64, 'dj_covers');
    }

    const newSong = {
        filename: title, originalName, filepath: url, coverUrl: coverUrl, genreId: genreIds[0] || 'none', genreIds,
        size: fileBuffer ? fileBuffer.length : 0, uploadTime: new Date().toISOString(), sequence: snapshot.size + 1, price,
        downloads: 0, plays: 0, status: reqBody.status || 'APPROVED', uploader, rejectReason: ''
    };
    const docRef = await db.collection('songs').add(newSong);
    if(newSong.status === 'PENDING' && newSong.uploader && String(newSong.uploader).toUpperCase() !== 'FULLKIK') {
        await addUserNotification(newSong.uploader, createNotification(
            'upload',
            `成功上传歌曲 - ${newSong.filename}`,
            '歌曲已进入待审队列，请等待管理员审核',
            { songId: docRef.id, status: newSong.status }
        ));
    }
    if(newSong.status === 'APPROVED') {
        await notifyFollowersOfSong(docRef.id, newSong);
    }
    return { id: docRef.id, ...newSong };
}

app.post('/api/upload', upload.single('mp3file'), async (req, res) => {
    try { if (!req.file) return res.status(400).send('No file.'); res.json(await saveSongData(req.file.buffer, req.file.originalname, req.body)); } 
    catch (e) { res.status(e.status || 500).send(e.message); }
});

app.put('/api/users/:username/songs/:id', async (req, res) => {
    try {
        const songRef = db.collection('songs').doc(req.params.id);
        const doc = await songRef.get();
        if(!doc.exists) return res.status(404).send('Song not found');
        const song = doc.data();
        if(String(song.uploader || '').toLowerCase() !== String(req.params.username || '').toLowerCase()) {
            return res.status(403).send('You do not own this song');
        }
        if(song.status !== 'APPROVED') return res.status(400).send('Only published songs can be edited');
        const filename = String(req.body.name || '').trim();
        const price = parseInt(req.body.price);
        const settings = await getGlobalSettings();
        const maxSongPrice = parseInt(settings.maxSongPrice) || 200;
        if(!filename) return res.status(400).send('歌曲名称不能为空');
        if(Number.isNaN(price) || price < 0) return res.status(400).send('歌曲价格无效');
        if(price > maxSongPrice) return res.status(400).send(`歌曲钻石价格不能超过 ${maxSongPrice}`);
        if(await containsSensitiveWord(filename)) {
            return res.status(400).send('歌曲资料包含敏感词');
        }
        await songRef.update({ filename, price, updatedAt: new Date().toISOString() });
        res.json({ id: doc.id, ...song, filename, price });
    } catch(e) { res.status(500).send(e.message); }
});

app.delete('/api/users/:username/songs/:id', async (req, res) => {
    try {
        const songRef = db.collection('songs').doc(req.params.id);
        const doc = await songRef.get();
        if(!doc.exists) return res.status(404).send('Song not found');
        const song = doc.data();
        if(String(song.uploader || '').toLowerCase() !== String(req.params.username || '').toLowerCase()) {
            return res.status(403).send('You do not own this song');
        }
        if(song.status !== 'APPROVED') return res.status(400).send('Only published songs can be deleted here');
        await songRef.delete();
        res.send('Deleted');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/songs/:id/settings', async (req, res) => {
    try {
        const songRef = db.collection('songs').doc(req.params.id);
        const oldDoc = await songRef.get();
        const oldSong = oldDoc.exists ? oldDoc.data() : {};
        let updates = {};
        if (req.body.newName) updates.filename = req.body.newName;
        if (req.body.newPrice !== undefined) updates.price = parseInt(req.body.newPrice) || 0;
        if (req.body.status) updates.status = req.body.status; 
        if (req.body.genreId) updates.genreId = req.body.genreId;
        if (req.body.genreIds !== undefined) {
            const genreIds = parseGenreIds(req.body);
            updates.genreIds = genreIds;
            updates.genreId = genreIds[0] || updates.genreId || oldSong.genreId || 'none';
        }
        if (req.body.rejectReason !== undefined) updates.rejectReason = req.body.rejectReason;
        if (req.body.coverBase64 && !req.body.coverBase64.includes('<svg')) updates.coverUrl = await uploadToCloudinaryBase64(req.body.coverBase64, 'dj_covers');
        await songRef.update(updates);

        if(req.body.status && req.body.status !== oldSong.status) {
            const actionMap = {
                APPROVED: '歌曲审核通过',
                REJECTED: '歌曲审核驳回',
                UNLISTED: '歌曲下架',
                REMOVED: '歌曲下架'
            };
            await logAdminAction(`${actionMap[req.body.status] || '歌曲状态更新'}: ${oldSong.filename || req.params.id}`, {
                module: '歌曲',
                action: actionMap[req.body.status] || '歌曲状态更新',
                targetId: req.params.id,
                details: `${oldSong.filename || req.params.id} | ${oldSong.status || '-'} -> ${req.body.status}${req.body.rejectReason ? ` | Reason: ${req.body.rejectReason}` : ''}`
            });
            if(oldSong.uploader && String(oldSong.uploader).toUpperCase() !== 'FULLKIK') {
                if(req.body.status === 'APPROVED') {
                    await addUserNotification(oldSong.uploader, createNotification(
                        'upload-approved',
                        `成功上传歌曲 - ${oldSong.filename || req.params.id}`,
                        '歌曲审核通过，已发布到 FULLKIK',
                        { songId: req.params.id, status: 'APPROVED' }
                    ));
                }
                if(req.body.status === 'REJECTED') {
                    await addUserNotification(oldSong.uploader, createNotification(
                        'upload-rejected',
                        `上传歌曲被拒绝 - ${oldSong.filename || req.params.id}`,
                        req.body.rejectReason || '未符合规范',
                        { songId: req.params.id, status: 'REJECTED', reason: req.body.rejectReason || '未符合规范' }
                    ));
                }
            }
            if(req.body.status === 'APPROVED') {
                await notifyFollowersOfSong(req.params.id, { ...oldSong, ...updates });
            }
        }

        res.send('Updated');
    } catch(e) { res.status(500).send(e.message); }
});

app.put('/api/songs/reorder', async (req, res) => {
    const batch = db.batch(); req.body.orderedIds.forEach((id, index) => { batch.update(db.collection('songs').doc(id), { sequence: index + 1 }); }); await batch.commit(); res.send('Reordered');
});
app.delete('/api/songs/:id', async (req, res) => { await db.collection('songs').doc(req.params.id).delete(); res.send('Deleted'); });

// --- SETTINGS & LOGS ---
app.get('/api/settings', async (req, res) => {
    res.json(await getGlobalSettings());
});

app.put('/api/settings', async (req, res) => { 
    try {
        let updates = {};
        if (req.body.headerTitle !== undefined) updates.headerTitle = req.body.headerTitle;
        if (req.body.heroTitle !== undefined) updates.heroTitle = req.body.heroTitle;
        if (req.body.homeMainTitle !== undefined) updates.homeMainTitle = String(req.body.homeMainTitle || '').trim() || DEFAULT_SETTINGS.homeMainTitle;
        if (req.body.homeSubtitle !== undefined) updates.homeSubtitle = String(req.body.homeSubtitle || '').trim() || DEFAULT_SETTINGS.homeSubtitle;
        if (req.body.homeAnnouncement !== undefined) updates.homeAnnouncement = String(req.body.homeAnnouncement || '').trim();
        if (req.body.uploadSuccessMessage !== undefined) {
            updates.uploadSuccessMessage = String(req.body.uploadSuccessMessage || '').trim().slice(0, 300) || DEFAULT_SETTINGS.uploadSuccessMessage;
        }
        if (req.body.uploadSuccessDuration !== undefined) {
            const duration = parseFloat(req.body.uploadSuccessDuration);
            updates.uploadSuccessDuration = Number.isFinite(duration) ? Math.min(Math.max(duration, 1), 30) : DEFAULT_SETTINGS.uploadSuccessDuration;
        }
        if (req.body.commissionStatement !== undefined) updates.commissionStatement = String(req.body.commissionStatement || '').trim() || DEFAULT_SETTINGS.commissionStatement;
        if (req.body.activity !== undefined) updates.activity = req.body.activity;
        if (req.body.contestActivities !== undefined) {
            updates.contestActivities = Array.isArray(req.body.contestActivities)
                ? req.body.contestActivities.slice(0, 50)
                : [];
        }
        if (req.body.coupons !== undefined) {
            updates.coupons = Array.isArray(req.body.coupons)
                ? req.body.coupons.slice(0, 200)
                : [];
        }
        if (req.body.topupExchangeRate !== undefined) {
            const rate = parseFloat(req.body.topupExchangeRate);
            updates.topupExchangeRate = Number.isFinite(rate) && rate > 0 ? Math.min(rate, 999) : DEFAULT_SETTINGS.topupExchangeRate;
        }
        if (req.body.topupPackages !== undefined) {
            const rows = Array.isArray(req.body.topupPackages) ? req.body.topupPackages : [];
            updates.topupPackages = rows.slice(0, 100).map((p, index) => ({
                id: String(p.id || ('PK' + Date.now() + index)).trim(),
                label: String(p.label || '').trim(),
                amount: Math.max(parseInt(p.amount) || 0, 0),
                bonus: Math.max(parseInt(p.bonus) || 0, 0),
                firstTopupBonus: Math.max(parseInt(p.firstTopupBonus) || 0, 0),
                rmPrice: Math.max(parseFloat(p.rmPrice) || 0, 0),
                sort: parseInt(p.sort) || (index + 1) * 10,
                enabled: p.enabled !== false
            })).filter(p => p.amount > 0 && p.rmPrice > 0);
        }
        if (req.body.maxSongPrice !== undefined) {
            let maxSongPrice = parseInt(req.body.maxSongPrice);
            if(Number.isNaN(maxSongPrice)) maxSongPrice = 200;
            updates.maxSongPrice = Math.min(Math.max(maxSongPrice, 1), 9999);
        }
        if (req.body.supportWhatsapp !== undefined) updates.supportWhatsapp = String(req.body.supportWhatsapp || '').trim();
        if (req.body.featuredGenreIds !== undefined) {
            updates.featuredGenreIds = Array.isArray(req.body.featuredGenreIds)
                ? req.body.featuredGenreIds.map(id => String(id)).filter(Boolean).slice(0, 6)
                : [];
        }
        if (req.body.categoryDisplayGenreIds !== undefined) {
            updates.categoryDisplayGenreIds = Array.isArray(req.body.categoryDisplayGenreIds)
                ? req.body.categoryDisplayGenreIds.map(id => String(id)).filter(Boolean).slice(0, 3)
                : [];
        }
        if (req.body.topNavGenreIds !== undefined) {
            updates.topNavGenreIds = Array.isArray(req.body.topNavGenreIds)
                ? req.body.topNavGenreIds.map(id => String(id)).filter(Boolean).slice(0, 3)
                : [];
        }
        if (req.body.hotProducerIds !== undefined) {
            updates.hotProducerIds = Array.isArray(req.body.hotProducerIds)
                ? req.body.hotProducerIds.map(id => String(id)).filter(Boolean).slice(0, 30)
                : [];
        }
        if (req.body.referralConfig !== undefined) {
            const cfg = req.body.referralConfig || {};
            updates.referralConfig = {
                enabled: !!cfg.enabled,
                referrerReward: Math.max(parseInt(cfg.referrerReward) || 10, 0),
                newUserReward: Math.max(parseInt(cfg.newUserReward) || 0, 0)
            };
        }
        
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

        if (req.body.homePosterBase64 !== undefined) {
            if(req.body.homePosterBase64 && req.body.homePosterBase64.startsWith('data:image')) {
                updates.homePosterUrl = await uploadToCloudinaryBase64(req.body.homePosterBase64, 'dj_posters');
            } else if(req.body.homePosterBase64) {
                updates.homePosterUrl = req.body.homePosterBase64;
            } else {
                updates.homePosterUrl = '';
            }
        }

        if (req.body.defaultCoverBase64 !== undefined) {
            if(req.body.defaultCoverBase64 && req.body.defaultCoverBase64.startsWith('data:image')) {
                updates.defaultCoverUrl = await uploadToCloudinaryBase64(req.body.defaultCoverBase64, 'dj_default_covers');
            } else if(req.body.defaultCoverBase64) {
                updates.defaultCoverUrl = req.body.defaultCoverBase64;
            } else {
                updates.defaultCoverUrl = '';
            }
        }

        await db.collection('settings').doc('global').set(updates, { merge: true }); 
        if(Object.keys(updates).some(k => ['maxSongPrice', 'supportWhatsapp', 'homePosterUrl', 'homeAnnouncement', 'uploadSuccessMessage', 'uploadSuccessDuration', 'defaultCoverUrl', 'featuredGenreIds', 'categoryDisplayGenreIds', 'topNavGenreIds', 'hotProducerIds', 'homeMainTitle', 'homeSubtitle', 'commissionStatement', 'contestActivities', 'coupons', 'topupExchangeRate', 'topupPackages', 'referralConfig'].includes(k))) {
            await logAdminAction('Updated system settings', {
                module: '系统',
                action: '系统设置',
                targetId: 'global',
                details: JSON.stringify(updates)
            });
        }
        res.send('Updated'); 
    } catch(e) { res.status(500).send(e.message); }
});

app.get('/api/logs/:type', async (req, res) => {
    try { const snap = await db.collection('logs').where('type', '==', req.params.type).get(); res.json(snap.docs.map(d => ({id: d.id, ...d.data()})).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp))); } catch(e) { res.json([]); }
});
app.post('/api/logs/delete', async (req, res) => { const batch = db.batch(); req.body.ids.forEach(id => batch.delete(db.collection('logs').doc(id))); await batch.commit(); res.send('ok'); });
app.delete('/api/logs/:type/all', async (req, res) => { const batch = db.batch(); (await db.collection('logs').where('type', '==', req.params.type).get()).docs.forEach(d => batch.delete(d.ref)); await batch.commit(); res.send('ok'); });

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server bound to 0.0.0.0 on Port ${PORT}`));
