# FULLKIK — Go-Live Setup Guide

This covers the 4 changes you asked for. **The code is done.** What's left is the
real-world accounts + settings that only you can create (a domain, Google
credentials, a HitPay merchant account). Follow each section top to bottom.

> Your app runs on **Render** (`musicscraper` service) and stores data in
> **Firebase Firestore**. All secrets live in Render → your service → **Environment**.
> Nothing sensitive is hard-coded.

---

## 0. Deploy the new code first

1. Put these updated files onto your Render service (git push, or however you deploy):
   `music.js`, `package.json`, `profile.html`, `register.html`, `reset-database.js`.
2. Render will run `npm install` (it picks up the new `google-auth-library`) and restart.
3. Add the environment variables from the sections below, then **Manual Deploy → Clear build cache & deploy** once at the end.

**New environment variables you'll add (full list):**

| Variable | Used for | Where it comes from |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Google login | Google Cloud (Section 2) |
| `HITPAY_API_KEY` | Real payments | HitPay dashboard (Section 3) |
| `HITPAY_SALT` | Verifying HitPay payments | HitPay dashboard (Section 3) |
| `HITPAY_API_URL` | Sandbox vs live | `https://api.sandbox.hit-pay.com/v1` (test) → `https://api.hit-pay.com/v1` (live) |
| `PUBLIC_BASE_URL` | Payment redirect/webhook links | `https://fullkik.com` (Section 1) |

*(Your existing `FIREBASE_SERVICE_ACCOUNT_JSON`, `CLOUDINARY_*`, `SMTP_*` stay as they are.)*

---

## 1. Domain → fullkik.com (you already own it)

The site currently answers at `musicscraper.onrender.com`. Point your domain at it:

1. **Render** → your `musicscraper` service → **Settings → Custom Domains → Add Custom Domain.**
   Add **both** `fullkik.com` and `www.fullkik.com`.
2. Render shows you DNS records to create. Typically:
   - `www` → **CNAME** → `musicscraper.onrender.com`
   - root `fullkik.com` → an **ALIAS/ANAME** (or the A record Render gives you).
3. Go to **where you bought fullkik.com** (your registrar's DNS settings) and add exactly those records.
4. Wait for DNS to propagate (minutes to a couple of hours). Render auto-issues the HTTPS certificate.
5. Set `PUBLIC_BASE_URL=https://fullkik.com` in Render env (payments use this to build return links).

**Note on the URL:** visitors typing `fullkik.com` are redirected to `fullkik.com/fullkik/main.page`
(the app's existing home route). That's normal and works. Leave it unless you want a deeper URL rewrite later.

---

## 2. Real "Sign in with Google" (added — old accounts still work)

Your old "gmail" accounts were never verified (registration OTP was simulated). Now there's a
real **Sign in with Google** button on the login/register page, sitting next to the existing
username/password (which still works, so **admin & staff logins are untouched**).

**Create your Google credential:**

1. Go to <https://console.cloud.google.com/> → create a project (e.g. "FULLKIK").
2. **APIs & Services → OAuth consent screen** → External → fill app name, your support email, save.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID → Web application.**
4. Under **Authorized JavaScript origins**, add:
   - `https://fullkik.com`
   - `https://www.fullkik.com`
   - `https://musicscraper.onrender.com` (so it works before DNS finishes)
5. Create. Copy the **Client ID** (looks like `xxxx.apps.googleusercontent.com`).
6. In Render env: `GOOGLE_CLIENT_ID = <that client id>`. Redeploy.

That's it — the frontend fetches the client id from the server automatically (`/api/public-config`),
so there's nothing to paste into the HTML.

**How it behaves:** if the Google email matches an existing account → logs in. If not → creates a new
account (username auto-derived from the email/name, 0 diamonds, `authProvider: google`).

---

## 3. Real top-up via HitPay (Touch 'n Go eWallet / FPX / card)

**Important:** the old top-up was a **simulation** — it added diamonds with **no real payment**.
That fake path is now **disabled**. Real money now flows like this:

```
User picks a package → server creates a HitPay bill → user pays on HitPay
(Touch 'n Go eWallet / FPX / card) → HitPay calls our webhook → we verify the
signature → diamonds credited exactly once.
```

Diamonds are **never** granted until HitPay confirms the money arrived.

**Set up your HitPay merchant account:**

1. Sign up at <https://www.hitpayapp.com/> (Malaysia). Complete the merchant/KYC steps
   (IC, bank account) so payouts land in your bank.
2. In the HitPay dashboard, enable the payment methods you want — **Touch 'n Go eWallet**, FPX, cards.
3. Get your API keys: **Settings → Payment Gateway / API Keys**. Copy:
   - **API Key** → Render env `HITPAY_API_KEY`
   - **Salt / Webhook Salt** → Render env `HITPAY_SALT`
4. Choose the environment in Render env `HITPAY_API_URL`:
   - Testing: `https://api.sandbox.hit-pay.com/v1`
   - Live: `https://api.hit-pay.com/v1`
5. Make sure `PUBLIC_BASE_URL=https://fullkik.com` is set (the webhook + redirect URLs are built from it).
6. Redeploy.

**Test it (do this in sandbox first):**
- Log in as a normal user → Profile → top-up → pick a package → 确认支付.
- You get redirected to HitPay → pay with a sandbox method.
- You're sent back to the profile page ("payment complete, diamonds arriving shortly").
- Within seconds the webhook credits the diamonds. Check the user's balance + the `orders` collection.

**Prices:** top-up packages are charged in **MYR** using each package's `rmPrice` (set in your
manager panel → 充值套餐). Coupons still apply and are validated server-side.

**Currency note:** the real HitPay flow charges in **MYR** (that's what Touch 'n Go / FPX use).
The old RMB (Alipay) / USD (USDT) options were part of the simulated flow and do **not** have a real
gateway — if you want those for real, they'd each need their own provider. For now, keep top-up on MYR.

---

## 4. Wipe all fake users + songs (full nuclear reset)

`reset-database.js` deletes **everything user-generated**: `users`, `songs`, `orders`,
`transactions`, `otp_logs`, `pending_orders`. (Notifications live inside user docs, so they go too.)
It **keeps** your site settings, packages, payment config, and coupons.

⚠️ **This is permanent.** Do it once, when you're ready to reopen for real.

**Easiest way — run it on Render (has your Firebase keys already):**

1. Render → your service → **Shell** tab.
2. First do a **dry run** (counts only, deletes nothing):
   ```
   node reset-database.js
   ```
3. If the counts look right, run the real wipe:
   ```
   node reset-database.js --yes
   ```

**Or run it locally** (you must supply the same Firebase service-account JSON):

```
FIREBASE_SERVICE_ACCOUNT_JSON='<paste the full JSON string>' node reset-database.js
FIREBASE_SERVICE_ACCOUNT_JSON='<paste the full JSON string>' node reset-database.js --yes
```

**Alternative (no script):** Firebase Console → Firestore → open each collection
(`users`, `songs`, `orders`, `transactions`, `otp_logs`, `pending_orders`) → delete.

> After wiping, create your admin/staff login again if needed (your admin login path is separate
> from user Google login and still works).

---

## Quick recap of what changed in the code

- `music.js` — added: `/api/public-config`, `/api/auth/google` (real Google verify + find/create user),
  `/api/payment/hitpay/create` + `/api/payment/hitpay/webhook` (real payment, HMAC-verified),
  `creditTopupTokens()` helper. Disabled the fake instant `/api/users/:username/topup` (now returns 410).
- `profile.html` — top-up now redirects to HitPay checkout; removed the "(Simulated)" label; shows a
  return message after payment.
- `register.html` — added the "Sign in with Google" button (login + signup views) and its handler.
- `package.json` — added `google-auth-library`.
- `reset-database.js` — **new** one-off nuclear wipe script.

**Honest status:** every line of code is written and syntax-checked. It cannot be fully tested from
here because the live keys (Firebase, Google, HitPay) live on your Render account — so run the HitPay
sandbox test in Section 3 and the dry-run in Section 4 before going live.
