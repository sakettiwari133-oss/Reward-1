/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║      CashBack Pro — PWA (Progressive Web App)                   ║
 * ║                                                                  ║
 * ║  User App    →  http://localhost:3000          (installable!)   ║
 * ║  Admin Panel →  http://localhost:3000/admin                     ║
 * ║                                                                  ║
 * ║  Run:   node server.js                                          ║
 * ║  Icons: node generate-icons.js  (run once first)               ║
 * ║                                                                  ║
 * ║  ZERO npm install — pure Node.js built-ins only                 ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 *  PWA FEATURES:
 *   ✅  Installable on Android & iOS ("Add to Home Screen")
 *   ✅  Works offline (service worker caches app shell)
 *   ✅  Offline coupon queue (submits when back online)
 *   ✅  Push notifications (when admin marks coupon as paid)
 *   ✅  App shortcuts (Submit Coupon, My History)
 *   ✅  Splash screen & theme color
 *   ✅  Standalone fullscreen mode (no browser UI)
 *
 *  DEFAULT ADMIN:  admin / admin123
 *
 *  ENV VARS:
 *   PORT=3000
 *   ADMIN_KEY=secret
 *   JWT_SECRET=secret
 *   NODE_ENV=production
 *   VAPID_PUBLIC_KEY=...   (for push notifications — see README)
 *   VAPID_PRIVATE_KEY=...
 */

'use strict';
const http   = require('http');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const PORT       = process.env.PORT       || 3000;
const ADMIN_KEY  = process.env.ADMIN_KEY  || 'admin-secret-key';
const JWT_SECRET = process.env.JWT_SECRET || 'cbpro-' + crypto.randomBytes(16).toString('hex');
const DB_FILE    = path.join(__dirname, 'cashback-data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OTP_TTL    = 5  * 60 * 1000;
const JWT_TTL    = 30 * 24 * 60 * 60 * 1000; // 30 days for PWA
const ADM_TTL    = 24 * 60 * 60 * 1000;

let DB = { users:{}, otps:{}, redemptions:{}, adminConfig:{ user:'admin', pass:'admin123' }, pushSubscriptions:{} };
function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try { const s=JSON.parse(fs.readFileSync(DB_FILE,'utf8')); DB={...DB,...s}; if(!DB.adminConfig)DB.adminConfig={user:'admin',pass:'admin123'}; if(!DB.pushSubscriptions)DB.pushSubscriptions={}; }
    catch(e) { console.warn('[DB] Corrupt — starting fresh'); }
  }
}
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); }
loadDB();

function b64u(s) { return Buffer.from(s).toString('base64url'); }
function signJWT(p, ttl) {
  const h=b64u(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const b=b64u(JSON.stringify({...p, iat:Date.now(), exp:Date.now()+(ttl||JWT_TTL)}));
  const s=crypto.createHmac('sha256',JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  return `${h}.${b}.${s}`;
}
function verifyJWT(token) {
  try {
    const [h,b,s]=token.split('.');
    const e=crypto.createHmac('sha256',JWT_SECRET).update(`${h}.${b}`).digest('base64url');
    if(e!==s)return null;
    const p=JSON.parse(Buffer.from(b,'base64url').toString());
    return p.exp<Date.now()?null:p;
  } catch { return null; }
}

const CORS = { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Admin-Key', 'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS' };
function jRes(res,st,d) { res.writeHead(st,{'Content-Type':'application/json',...CORS}); res.end(JSON.stringify(d)); }
function hRes(res,html) { res.writeHead(200,{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-cache'}); res.end(html); }
function body(req) { return new Promise((ok,fail)=>{ let s=''; req.on('data',c=>s+=c); req.on('end',()=>{ try{ok(s?JSON.parse(s):{})}catch{fail(new Error('Bad JSON'))} }); }); }
function getAuth(req) { const a=(req.headers['authorization']||''); const t=a.startsWith('Bearer ')?a.slice(7):null; return t?verifyJWT(t):null; }
function isAdmin(req) { if(req.headers['x-admin-key']===ADMIN_KEY)return true; const a=getAuth(req); return a&&a.role==='admin'; }

// Serve static files from /public (sw.js, manifest.json, icons/)
function serveStatic(req, res) {
  const filePath = path.join(PUBLIC_DIR, req.url.split('?')[0]);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = { '.js':'application/javascript', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon', '.webp':'image/webp' };
  const mime = mimeTypes[ext] || 'application/octet-stream';
  const cacheControl = ext==='.js'&&req.url.includes('sw.js') ? 'no-cache' : 'public,max-age=86400';
  res.writeHead(200, { 'Content-Type':mime, 'Cache-Control':cacheControl });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function sendOTPSMS(phone, otp) {
  // Replace with MSG91 / Fast2SMS for real SMS
  console.log(`\n  OTP  +91${phone}  =>  ${otp}\n`);
}

// ══════════════════════════════════════════════════════════════════════
//  USER APP HTML
// ══════════════════════════════════════════════════════════════════════
const USER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="CashBack Pro">
<meta name="theme-color" content="#4361ee">
<meta name="description" content="Submit coupons from any app and earn cashback directly to your UPI ID.">
<title>CashBack Pro</title>
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/icon-192.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
:root{--bg:#f0f4ff;--w:#fff;--sf:#f7f9ff;--pr:#4361ee;--prl:#eef0ff;--gr:#06c270;--grl:#e6faf2;--am:#ff9f1c;--aml:#fff5e6;--re:#f7263e;--rel:#fff0f2;--tx:#0d1117;--sb:#4a5568;--mu:#94a3b8;--bo:#e2e8f0;--ra:16px;--sh:0 4px 24px rgba(67,97,238,.1);--sat:env(safe-area-inset-top);--sab:env(safe-area-inset-bottom);}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{height:100%}
body{height:100%;font-family:'Plus Jakarta Sans',sans-serif;background:var(--bg);color:var(--tx);overflow:hidden;-webkit-overflow-scrolling:touch}
#app{max-width:440px;margin:0 auto;height:100vh;height:100dvh;background:var(--w);display:flex;flex-direction:column;box-shadow:0 0 60px rgba(67,97,238,.08);position:relative;overflow:hidden}
.screen{display:none;flex-direction:column;height:100%;animation:fu .32s cubic-bezier(.16,1,.3,1) both}
.screen.active{display:flex}
@keyframes fu{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.topbar{padding:calc(var(--sat) + 16px) 22px 0;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;background:var(--w)}
.li{width:38px;height:38px;background:var(--pr);border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.2rem}
.ln{font-weight:800;font-size:1.05rem;color:var(--tx)}.lt{font-size:.65rem;font-weight:600;color:var(--pr);background:var(--prl);border-radius:6px;padding:2px 7px;letter-spacing:.5px}
.tl{display:flex;align-items:center;gap:9px}.ua{width:36px;height:36px;border-radius:50%;background:var(--prl);display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:var(--pr);cursor:pointer}
.hero{margin:16px 20px 0;background:linear-gradient(135deg,#4361ee,#7b2ff7);border-radius:22px;padding:22px 20px;color:#fff;position:relative;overflow:hidden;flex-shrink:0}
.hero::before{content:'';position:absolute;right:-20px;top:-20px;width:140px;height:140px;background:rgba(255,255,255,.08);border-radius:50%}
.hl{font-size:.7rem;font-weight:600;letter-spacing:1.5px;opacity:.8;text-transform:uppercase;margin-bottom:5px}
.ht{font-size:1.5rem;font-weight:800;line-height:1.2;margin-bottom:3px}.hs{font-size:.8rem;opacity:.75}
.hb{display:inline-flex;align-items:center;gap:4px;background:rgba(255,255,255,.18);border-radius:50px;padding:4px 11px;font-size:.7rem;font-weight:600;margin-top:10px;backdrop-filter:blur(8px)}
.sr{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 20px 0;flex-shrink:0}
.sb2{background:var(--sf);border-radius:14px;padding:14px;border:1px solid var(--bo)}.sbi{font-size:1.3rem;margin-bottom:6px;display:block}.sbv{font-size:1.4rem;font-weight:800;color:var(--tx)}.sbl{font-size:.7rem;color:var(--mu);font-weight:500}
.scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:8px}.scroll::-webkit-scrollbar{display:none}
.sec{padding:14px 20px 0}.stit{font-size:.72rem;font-weight:700;color:var(--mu);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px}
.hi{display:flex;align-items:center;gap:12px;padding:14px;background:var(--w);border:1px solid var(--bo);border-radius:14px;margin-bottom:8px}
.hii{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
.hin{flex:1;min-width:0}.hic{font-weight:700;font-size:.88rem;letter-spacing:1px;color:var(--tx)}.hico{font-size:.72rem;font-weight:600;color:var(--sb)}.him{font-size:.7rem;color:var(--mu);margin-top:2px}
.hir{text-align:right;flex-shrink:0}.hia{font-size:.95rem;font-weight:800;color:var(--tx)}
.badge{display:inline-flex;align-items:center;padding:2px 9px;border-radius:50px;font-size:.65rem;font-weight:700;margin-top:3px}
.b1{background:var(--prl);color:var(--pr)}.b2{background:var(--aml);color:var(--am)}.b3{background:var(--grl);color:var(--gr)}
.bn{background:var(--w);border-top:1px solid var(--bo);display:flex;padding:8px 0;padding-bottom:calc(var(--sab) + 8px);flex-shrink:0;z-index:50}
.bi{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:4px 0;cursor:pointer}
.bii{font-size:1.2rem;transition:transform .2s}.bil{font-size:.6rem;font-weight:700;letter-spacing:.5px;color:var(--mu)}
.bi.on .bil{color:var(--pr)}.bi.on .bii{transform:scale(1.12)}.bd{width:3px;height:3px;border-radius:50%;background:var(--pr);margin-top:1px;display:none}.bi.on .bd{display:block}
.aw{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:36px 24px;padding-top:calc(var(--sat) + 36px);background:var(--w);overflow-y:auto}
.ai{font-size:3rem;margin-bottom:16px}.at{font-size:1.4rem;font-weight:800;margin-bottom:6px;text-align:center;color:var(--tx)}.as2{font-size:.88rem;color:var(--sb);line-height:1.6;text-align:center;margin-bottom:22px}
.pr3{display:flex;gap:8px;align-items:center;width:100%}.cb{background:var(--sf);border:1.5px solid var(--bo);border-radius:14px;padding:12px;font-size:.9rem;font-weight:700;color:var(--sb);min-width:68px;text-align:center}
.inp{width:100%;background:var(--sf);border:1.5px solid var(--bo);border-radius:14px;padding:13px 16px;font-family:inherit;font-size:.92rem;color:var(--tx);outline:none;transition:all .22s}
.inp:focus{border-color:var(--pr);background:var(--w);box-shadow:0 0 0 3px rgba(67,97,238,.08)}.inp::placeholder{color:var(--mu)}.inp.err{border-color:var(--re)}
.ie{font-size:.72rem;color:var(--re);margin-top:4px;display:none}
.ig{margin-bottom:16px}.il{font-size:.76rem;font-weight:700;color:var(--sb);letter-spacing:.5px;margin-bottom:6px;display:block}
.iw{position:relative}.ic{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:1rem;pointer-events:none}
.cc{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px}
.chip{display:flex;align-items:center;gap:4px;padding:6px 12px;background:var(--sf);border:1.5px solid var(--bo);border-radius:50px;font-size:.75rem;font-weight:600;color:var(--sb);cursor:pointer;transition:all .18s;user-select:none}
.chip:hover,.chip.s{background:var(--prl);border-color:var(--pr);color:var(--pr)}
.sg{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}
.sbn{padding:9px 7px;background:var(--sf);border:1.5px solid var(--bo);border-radius:11px;font-size:.75rem;font-weight:600;color:var(--sb);cursor:pointer;transition:all .18s;text-align:center;font-family:inherit}
.sbn:hover,.sbn.s{background:var(--prl);border-color:var(--pr);color:var(--pr)}
.ci{width:100%;background:var(--sf);border:1.5px solid var(--bo);border-radius:14px;padding:13px 16px;font-family:inherit;font-size:1rem;font-weight:700;color:var(--tx);outline:none;letter-spacing:2px;text-transform:uppercase}
.ci:focus{border-color:var(--pr);background:var(--w)}.ci::placeholder{letter-spacing:0;font-weight:400;font-size:.88rem;text-transform:none}
.bp{width:100%;padding:15px;background:linear-gradient(135deg,#4361ee,#7b2ff7);color:#fff;border:none;border-radius:14px;font-family:inherit;font-weight:700;font-size:.95rem;cursor:pointer;transition:all .25s}
.bp:active{transform:scale(.98)}.bp:disabled{opacity:.55;cursor:not-allowed}
.bp.g{background:linear-gradient(135deg,#06c270,#00a65e)}.bs{width:100%;padding:13px;background:var(--sf);border:1.5px solid var(--bo);border-radius:14px;font-family:inherit;font-weight:700;font-size:.88rem;color:var(--sb);cursor:pointer;margin-top:8px}
.bl{background:none;border:none;color:var(--pr);font-family:inherit;font-weight:600;font-size:.86rem;cursor:pointer;padding:0}
.or{display:flex;gap:9px;justify-content:center;margin:8px 0}
.ob{width:50px;height:56px;border:2px solid var(--bo);border-radius:13px;text-align:center;font-size:1.3rem;font-weight:800;color:var(--tx);background:var(--sf);outline:none;transition:all .18s;font-family:inherit}
.ob:focus{border-color:var(--pr);background:var(--w)}.ob.f{border-color:var(--pr);background:var(--prl);color:var(--pr)}
.rr{text-align:center;margin-top:10px;font-size:.8rem;color:var(--mu)}.tm{font-weight:700;color:var(--pr)}
.fb{padding:18px 20px;flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}.fb::-webkit-scrollbar{display:none}
.sw2{display:flex;flex-direction:column;align-items:center;text-align:center;padding:32px 20px 20px;overflow-y:auto}
.sr3{width:78px;height:78px;border-radius:50%;background:var(--grl);border:2.5px solid var(--gr);display:flex;align-items:center;justify-content:center;font-size:2.2rem;margin-bottom:16px;animation:pop .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
.st2{font-size:1.4rem;font-weight:800;margin-bottom:6px;color:var(--tx)}.ss2{font-size:.86rem;color:var(--sb);line-height:1.6;margin-bottom:18px}
.dt{width:100%;text-align:left;border-radius:13px;overflow:hidden;border:1px solid var(--bo);margin-bottom:16px}
.dr{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--bo)}.dr:last-child{border:none}
.dl{font-size:.75rem;color:var(--mu);font-weight:500}.dv{font-size:.82rem;font-weight:700;color:var(--tx)}.dv.bl2{color:var(--pr)}
.ph{padding:24px 20px 18px;text-align:center;border-bottom:1px solid var(--bo);flex-shrink:0}
.pav{width:68px;height:68px;border-radius:50%;background:linear-gradient(135deg,#4361ee,#7b2ff7);display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:#fff;margin:0 auto 10px}
.pn{font-size:1.05rem;font-weight:800;color:var(--tx)}.pp{font-size:.82rem;color:var(--mu);margin-top:2px}
.prow{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--bo);cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background .15s}
.prow:active{background:var(--sf)}.pl{display:flex;align-items:center;gap:11px;font-size:.88rem;font-weight:600;color:var(--tx)}.pi{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:.95rem}
.sp{width:18px;height:18px;border:2.5px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;vertical-align:middle}
@keyframes spin{to{transform:rotate(360deg)}}
.es{text-align:center;padding:40px 16px}.ei{font-size:2.8rem;display:block;margin-bottom:10px;opacity:.3}.et{font-size:.95rem;font-weight:700;color:var(--sb);margin-bottom:4px}.em{font-size:.78rem;color:var(--mu)}
#toast{position:absolute;bottom:calc(var(--sab) + 70px);left:50%;transform:translateX(-50%) translateY(18px);background:#0d1117;color:#fff;padding:10px 18px;border-radius:50px;font-size:.78rem;font-weight:600;opacity:0;transition:all .28s;z-index:99;white-space:nowrap;max-width:88%;text-align:center;pointer-events:none}
#toast.on{opacity:1;transform:translateX(-50%) translateY(0)}

/* Install banner */
#installBanner{position:absolute;top:calc(var(--sat) + 8px);left:12px;right:12px;background:#fff;border:1px solid var(--bo);border-radius:14px;padding:12px 14px;display:none;align-items:center;gap:10px;z-index:100;box-shadow:0 4px 20px rgba(0,0,0,.12)}
#installBanner.show{display:flex}
.install-icon{font-size:1.6rem;flex-shrink:0}
.install-text{flex:1}.install-title{font-size:.82rem;font-weight:700;color:var(--tx)}.install-sub{font-size:.7rem;color:var(--mu)}
.install-btn{background:var(--pr);color:#fff;border:none;border-radius:9px;padding:6px 12px;font-family:inherit;font-weight:700;font-size:.75rem;cursor:pointer;white-space:nowrap}
.install-close{background:none;border:none;color:var(--mu);font-size:1rem;cursor:pointer;padding:2px;flex-shrink:0}

/* Offline indicator */
#offlineBar{position:absolute;top:0;left:0;right:0;background:#ff9f1c;color:#fff;text-align:center;font-size:.75rem;font-weight:700;padding:4px 12px;padding-top:calc(var(--sat) + 4px);display:none;z-index:200}
#offlineBar.show{display:block}
</style>
</head>
<body>
<div id="app">
<div id="toast"></div>
<div id="offlineBar">📡 You're offline — submissions will sync when reconnected</div>
<div id="installBanner">
  <div class="install-icon">💸</div>
  <div class="install-text"><div class="install-title">Install CashBack Pro</div><div class="install-sub">Add to home screen for the best experience</div></div>
  <button class="install-btn" id="installBtn">Install</button>
  <button class="install-close" id="installClose">✕</button>
</div>

<!-- AUTH -->
<div class="screen active" id="s-auth">
  <div class="aw">
    <div class="ai">📱</div>
    <div class="at">CashBack Pro</div>
    <div class="as2" id="authSub">Enter your mobile number to login or create your account.</div>
    <div style="width:100%" id="phoneStep">
      <div class="ig"><label class="il">Mobile Number</label><div class="pr3"><div class="cb">🇮🇳 +91</div><div class="iw" style="flex:1"><input class="inp" type="tel" id="authPhone" placeholder="98765 43210" maxlength="10" inputmode="numeric" oninput="this.value=this.value.replace(/\\D/g,'')"><span class="ic">📱</span></div></div><div class="ie" id="phoneErr">Enter a valid 10-digit number</div></div>
      <button class="bp" id="sendOtpBtn" onclick="sendOTP()">Send OTP →</button>
      <p style="font-size:.75rem;color:var(--mu);text-align:center;margin-top:10px">🔒 Verified & secure · One account per number</p>
    </div>
    <div style="width:100%;display:none" id="otpStep">
      <p style="text-align:center;font-size:.84rem;color:var(--sb);margin-bottom:12px">OTP sent to <strong id="otpTo"></strong></p>
      <div id="otpDevBox" style="display:none;background:#d1fae5;border:2px solid #10b981;border-radius:14px;padding:14px;text-align:center;margin-bottom:14px"><div style="font-size:.72rem;font-weight:700;color:#065f46;margin-bottom:6px;text-transform:uppercase;letter-spacing:1px">Your OTP (SMS not configured)</div><div class="otp-dev-code" style="font-size:2.2rem;font-weight:800;letter-spacing:12px;color:#064e3b">----</div><div style="font-size:.7rem;color:#047857;margin-top:6px">Enter these 4 digits below</div></div>
      <div class="or"><input class="ob" type="tel" maxlength="1" inputmode="numeric" oninput="oM(this,0)" onkeydown="oB(event,this,0)"><input class="ob" type="tel" maxlength="1" inputmode="numeric" oninput="oM(this,1)" onkeydown="oB(event,this,1)"><input class="ob" type="tel" maxlength="1" inputmode="numeric" oninput="oM(this,2)" onkeydown="oB(event,this,2)"><input class="ob" type="tel" maxlength="1" inputmode="numeric" oninput="oM(this,3)" onkeydown="oB(event,this,3)"></div>
      <div class="ie" id="otpErr" style="text-align:center;margin-bottom:8px">Incorrect OTP. Try again.</div>
      <div class="rr">Resend in <span class="tm" id="timer">30s</span></div>
      <div style="margin-top:16px"><button class="bp" id="verifyBtn" onclick="verifyOTP()">Verify & Login</button><button class="bl" style="display:block;text-align:center;margin-top:12px" onclick="backPhone()">← Change Number</button></div>
    </div>
  </div>
</div>

<!-- HOME -->
<div class="screen" id="s-home">
  <div class="topbar"><div class="tl"><div class="li">💸</div><div><div class="ln">CashBack Pro</div><div class="lt">REDEEM & EARN</div></div></div><div class="ua" id="hAv" onclick="gTab('profile')">U</div></div>
  <div class="scroll">
    <div class="hero"><div class="hl">Your Cashback</div><div class="ht" id="hAmt">₹0<br><span style="font-size:.9rem;font-weight:500;opacity:.8">Total Submitted</span></div><div class="hs">Submit coupons from any app & get paid</div><div class="hb">⚡ 2–3 day UPI payout</div></div>
    <div class="sr"><div class="sb2"><span class="sbi">📋</span><div class="sbv" id="sSub">0</div><div class="sbl">Submitted</div></div><div class="sb2"><span class="sbi">✅</span><div class="sbv" id="sPaid">₹0</div><div class="sbl">Paid Out</div></div></div>
    <div class="sec"><div class="stit">Recent Activity</div><div id="recent"></div></div>
    <div style="padding:12px 20px 0"><button class="bp g" onclick="gTab('redeem')" style="font-size:.9rem;padding:14px">🎟️ Submit a Coupon →</button></div>
  </div>
  <div class="bn"><div class="bi on" onclick="gTab('home')"><div class="bii">🏠</div><div class="bil">HOME</div><div class="bd"></div></div><div class="bi" onclick="gTab('redeem')"><div class="bii">🎟️</div><div class="bil">REDEEM</div><div class="bd"></div></div><div class="bi" onclick="gTab('history')"><div class="bii">📜</div><div class="bil">HISTORY</div><div class="bd"></div></div><div class="bi" onclick="gTab('profile')"><div class="bii">👤</div><div class="bil">PROFILE</div><div class="bd"></div></div></div>
</div>

<!-- REDEEM -->
<div class="screen" id="s-redeem">
  <div class="topbar"><div class="tl"><div class="li">💸</div><div><div class="ln">Submit Coupon</div><div class="lt">EARN CASHBACK</div></div></div></div>
  <div class="fb" id="rForm" style="display:flex;flex-direction:column">
    <div style="margin-top:10px">
      <div class="ig"><label class="il">Company / App Name</label><div class="iw"><input class="inp" type="text" id="rCo" placeholder="e.g. Swiggy, Zomato, Amazon" oninput="fChips(this.value)"><span class="ic">🏢</span></div><div class="ie" id="coErr">Enter company name</div><div class="cc" id="chips"><div class="chip" onclick="selCo('Swiggy','🍔')">🍔 Swiggy</div><div class="chip" onclick="selCo('Zomato','🍕')">🍕 Zomato</div><div class="chip" onclick="selCo('Amazon','📦')">📦 Amazon</div><div class="chip" onclick="selCo('Flipkart','🛒')">🛒 Flipkart</div><div class="chip" onclick="selCo('Myntra','👗')">👗 Myntra</div><div class="chip" onclick="selCo('BigBasket','🥦')">🥦 BigBasket</div><div class="chip" onclick="selCo('Blinkit','⚡')">⚡ Blinkit</div><div class="chip" onclick="selCo('Nykaa','💄')">💄 Nykaa</div></div></div>
      <div class="ig"><label class="il">Coupon Code</label><input class="ci" type="text" id="rCode" placeholder="e.g. SAVE200"><div class="ie" id="codeErr">Enter coupon code</div></div>
      <div class="ig"><label class="il">Source</label><div class="sg"><div class="sbn" onclick="selSrc(this,'SMS')">📱 SMS</div><div class="sbn" onclick="selSrc(this,'Email')">📧 Email</div><div class="sbn" onclick="selSrc(this,'WhatsApp')">💬 WhatsApp</div><div class="sbn" onclick="selSrc(this,'App Notification')">🔔 App</div></div><div class="ie" id="srcErr">Select a source</div></div>
      <div class="ig"><label class="il">UPI ID for Payment</label><div class="iw"><input class="inp" type="email" id="rUPI" placeholder="yourname@upi" inputmode="email"><span class="ic">💳</span></div><div style="display:flex;gap:6px;margin-top:7px;flex-wrap:wrap"><button class="sbn" style="flex:0 0 auto;padding:5px 11px" onclick="addUPI('@okaxis')">@okaxis</button><button class="sbn" style="flex:0 0 auto;padding:5px 11px" onclick="addUPI('@paytm')">@paytm</button><button class="sbn" style="flex:0 0 auto;padding:5px 11px" onclick="addUPI('@ybl')">@ybl</button><button class="sbn" style="flex:0 0 auto;padding:5px 11px" onclick="addUPI('@oksbi')">@oksbi</button></div><div class="ie" id="upiErr">Enter a valid UPI ID</div></div>
      <button class="bp" id="subBtn" onclick="submitCoupon()">Submit for Review →</button>
    </div>
  </div>
  <div class="sw2" id="rOk" style="display:none">
    <div class="sr3">🎉</div><div class="st2">Submitted!</div><div class="ss2">Your coupon is under review. Cashback in 2–3 days to your UPI.</div>
    <div class="dt" id="okTable"></div>
    <button class="bp" onclick="another()" style="margin-bottom:8px">Submit Another →</button>
    <button class="bs" onclick="gTab('history')">View History</button>
  </div>
  <div class="bn"><div class="bi" onclick="gTab('home')"><div class="bii">🏠</div><div class="bil">HOME</div><div class="bd"></div></div><div class="bi on" onclick="gTab('redeem')"><div class="bii">🎟️</div><div class="bil">REDEEM</div><div class="bd"></div></div><div class="bi" onclick="gTab('history')"><div class="bii">📜</div><div class="bil">HISTORY</div><div class="bd"></div></div><div class="bi" onclick="gTab('profile')"><div class="bii">👤</div><div class="bil">PROFILE</div><div class="bd"></div></div></div>
</div>

<!-- HISTORY -->
<div class="screen" id="s-history">
  <div class="topbar"><div class="tl"><div class="li">💸</div><div><div class="ln">My History</div><div class="lt">ALL SUBMISSIONS</div></div></div></div>
  <div style="padding:14px 20px 0;flex-shrink:0"><select class="inp" id="hFil" onchange="renderHist()" style="padding:11px 16px;height:auto">
    <option value="all">All Submissions</option><option value="review">In Review</option><option value="pending">Pending Payment</option><option value="paid">Paid ✅</option>
  </select></div>
  <div class="scroll" style="padding:10px 20px" id="histList"></div>
  <div class="bn"><div class="bi" onclick="gTab('home')"><div class="bii">🏠</div><div class="bil">HOME</div><div class="bd"></div></div><div class="bi" onclick="gTab('redeem')"><div class="bii">🎟️</div><div class="bil">REDEEM</div><div class="bd"></div></div><div class="bi on" onclick="gTab('history')"><div class="bii">📜</div><div class="bil">HISTORY</div><div class="bd"></div></div><div class="bi" onclick="gTab('profile')"><div class="bii">👤</div><div class="bil">PROFILE</div><div class="bd"></div></div></div>
</div>

<!-- PROFILE -->
<div class="screen" id="s-profile">
  <div class="scroll">
    <div class="ph"><div class="pav" id="pAv">U</div><div class="pn" id="pNm">—</div><div class="pp" id="pPh">—</div></div>
    <div class="prow" onclick="gTab('history')"><div class="pl"><div class="pi" style="background:#eef0ff">📜</div>My Redemption History</div><span style="color:var(--mu)">›</span></div>
    <div class="prow" onclick="gTab('redeem')"><div class="pl"><div class="pi" style="background:#e6faf2">🎟️</div>Redeem a New Coupon</div><span style="color:var(--mu)">›</span></div>
    <div class="prow" id="notifRow" onclick="requestNotifPerm()"><div class="pl"><div class="pi" style="background:#eef0ff">🔔</div>Enable Notifications</div><span style="color:var(--mu)">›</span></div>
    <div class="prow"><div class="pl"><div class="pi" style="background:#fff5e6">⚡</div>Payout Time</div><span style="font-size:.75rem;background:var(--grl);color:var(--gr);padding:3px 10px;border-radius:50px;font-weight:700">2–3 Days</span></div>
    <div class="prow" onclick="logout()" style="margin-top:10px"><div class="pl"><div class="pi" style="background:#fff0f2">🚪</div><span style="color:var(--re)">Logout</span></div><span style="color:var(--mu)">›</span></div>
  </div>
  <div class="bn"><div class="bi" onclick="gTab('home')"><div class="bii">🏠</div><div class="bil">HOME</div><div class="bd"></div></div><div class="bi" onclick="gTab('redeem')"><div class="bii">🎟️</div><div class="bil">REDEEM</div><div class="bd"></div></div><div class="bi" onclick="gTab('history')"><div class="bii">📜</div><div class="bil">HISTORY</div><div class="bd"></div></div><div class="bi on" onclick="gTab('profile')"><div class="bii">👤</div><div class="bil">PROFILE</div><div class="bd"></div></div></div>
</div>

</div><!-- #app -->

<script>
'use strict';
let cU=null,aT=null,recs=[],selSrc2='',selIcon='🏢',oTmr=null;
const $=id=>document.getElementById(id);

// ── PWA: SERVICE WORKER ──────────────────────────────────────────────
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('/sw.js',{scope:'/'})
      .then(reg=>{ console.log('[PWA] SW registered'); })
      .catch(err=>console.warn('[PWA] SW failed:', err));
  });
}

// ── PWA: INSTALL PROMPT ──────────────────────────────────────────────
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{
  e.preventDefault(); deferredPrompt=e;
  setTimeout(()=>{ if(!localStorage.getItem('installDismissed')) $('installBanner').classList.add('show'); }, 3000);
});
$('installBtn').onclick=async()=>{
  if(!deferredPrompt)return;
  deferredPrompt.prompt();
  const{outcome}=await deferredPrompt.userChoice;
  deferredPrompt=null; $('installBanner').classList.remove('show');
  if(outcome==='accepted')toast('🎉 App installed! Find it on your home screen.');
};
$('installClose').onclick=()=>{ $('installBanner').classList.remove('show'); localStorage.setItem('installDismissed','1'); };
window.addEventListener('appinstalled',()=>{ $('installBanner').classList.remove('show'); toast('✅ CashBack Pro installed!'); });

// ── PWA: OFFLINE DETECTION ───────────────────────────────────────────
function updateOnlineStatus(){
  if(!navigator.onLine){ $('offlineBar').classList.add('show'); }
  else { $('offlineBar').classList.remove('show'); syncOfflineQueue(); }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);
updateOnlineStatus();

// ── PWA: OFFLINE QUEUE (IndexedDB) ───────────────────────────────────
function openIDB(){
  return new Promise((ok,fail)=>{
    const r=indexedDB.open('cashback-offline',1);
    r.onupgradeneeded=e=>{ const db=e.target.result; if(!db.objectStoreNames.contains('pending-submissions'))db.createObjectStore('pending-submissions',{keyPath:'id',autoIncrement:true}); };
    r.onsuccess=e=>ok(e.target.result); r.onerror=e=>fail(e.target.error);
  });
}
async function queueOfflineSubmission(data){
  const db=await openIDB();
  return new Promise((ok,fail)=>{
    const tx=db.transaction('pending-submissions','readwrite');
    const req=tx.objectStore('pending-submissions').add({data,token:aT,ts:Date.now()});
    req.onsuccess=()=>ok(); req.onerror=e=>fail(e.target.error);
  });
}
async function syncOfflineQueue(){
  try{
    const db=await openIDB();
    const tx=db.transaction('pending-submissions','readwrite');
    const store=tx.objectStore('pending-submissions');
    const all=await new Promise((ok,fail)=>{ const r=store.getAll(); r.onsuccess=e=>ok(e.target.result); r.onerror=e=>fail(e.target.error); });
    for(const item of all){
      try{
        const res=await fetch('/api/redemptions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+item.token},body:JSON.stringify(item.data)});
        if(res.ok){ store.delete(item.id); toast('📤 Offline coupon synced!'); await loadRecs(); loadHome(); }
      }catch{}
    }
  }catch{}
}

// ── PWA: PUSH NOTIFICATIONS ──────────────────────────────────────────
async function requestNotifPerm(){
  if(!('Notification' in window)){ toast('Notifications not supported on this browser'); return; }
  if(Notification.permission==='granted'){ toast('Notifications already enabled ✅'); return; }
  const perm=await Notification.requestPermission();
  if(perm==='granted'){
    toast('🔔 Notifications enabled!');
    $('notifRow').querySelector('.pl div:last-child').textContent='Notifications enabled ✅';
    await subscribePush();
  } else { toast('Notifications blocked. Enable in browser settings.'); }
}
async function subscribePush(){
  try{
    const reg=await navigator.serviceWorker.ready;
    const sub=await reg.pushManager.subscribe({userVisibleOnly:true, applicationServerKey: urlBase64ToUint8Array('BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjZkFZmkuhkViTan9wgdLG4Oy4-jQ') });
    await api('POST','/push/subscribe',sub);
  }catch(e){ console.log('[Push] Subscribe failed:', e); }
}
function urlBase64ToUint8Array(b64){
  const p='='+''.repeat((4-b64.length%4)%4);
  const b=(b64+p).replace(/-/g,'+').replace(/_/g,'/');
  const r=atob(b);return Uint8Array.from(r,c=>c.charCodeAt(0));
}

// ── SHORTCUTS: deep link support (?tab=redeem etc) ───────────────────
window.addEventListener('DOMContentLoaded',()=>{
  const tab=new URLSearchParams(location.search).get('tab');
  if(tab&&['redeem','history','profile'].includes(tab)){
    if(cU||localStorage.getItem('cbT')) setTimeout(()=>gTab(tab),500);
  }
});

// ── UTILS ────────────────────────────────────────────────────────────
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),2600);}
function scr(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');}
async function api(method,path,body2){
  const o={method,headers:{'Content-Type':'application/json'}};
  if(aT)o.headers['Authorization']='Bearer '+aT;
  if(body2)o.body=JSON.stringify(body2);
  const r=await fetch('/api'+path,o);const d=await r.json();
  if(!r.ok)throw new Error(d.error||'Failed');return d;
}

// ── AUTH ──────────────────────────────────────────────────────────────
window.sendOTP=async function(){
  const p=$('authPhone').value.trim();
  if(!/^\\d{10}$/.test(p)){$('phoneErr').style.display='block';return;}
  $('phoneErr').style.display='none';
  const b=$('sendOtpBtn');b.disabled=true;b.innerHTML='<span class="sp"></span>';
  try{
    const r=await api('POST','/auth/send-otp',{phone:p});
    $('otpTo').textContent='+91 '+p.replace(/(\\d{5})(\\d{5})/,'$1 $2');
    $('phoneStep').style.display='none';$('otpStep').style.display='block';
    $('authSub').textContent='Enter the 4-digit OTP sent to your number';
    if(r.dev_otp){const box=$('otpDevBox');if(box){box.style.display='block';box.querySelector('.otp-dev-code').textContent=r.dev_otp;}toast('OTP: '+r.dev_otp);}else{toast('📱 OTP sent to your number!');}
    startTmr();setTimeout(()=>document.querySelector('.ob').focus(),100);
  }catch(e){toast('❌ '+e.message);}
  b.disabled=false;b.innerHTML='Send OTP →';
};
function startTmr(){
  let s=30;$('timer').textContent=s+'s';
  if(oTmr)clearInterval(oTmr);
  oTmr=setInterval(()=>{s--;$('timer').textContent=s+'s';if(s<=0){clearInterval(oTmr);$('timer').innerHTML='<button class="bl" onclick="sendOTP()">Resend OTP</button>';}},1000);
}
window.oM=function(el,i){el.value=el.value.replace(/\\D/g,'');el.classList.toggle('f',!!el.value);const b=document.querySelectorAll('.ob');if(el.value&&i<3)b[i+1].focus();if([...b].map(x=>x.value).join('').length===4)verifyOTP();};
window.oB=function(e,el,i){if(e.key==='Backspace'&&!el.value&&i>0)document.querySelectorAll('.ob')[i-1].focus();};
window.verifyOTP=async function(){
  const bs=document.querySelectorAll('.ob');const en=[...bs].map(b=>b.value).join('');if(en.length<4)return;
  const p=$('authPhone').value.trim();const btn=$('verifyBtn');btn.disabled=true;btn.innerHTML='<span class="sp"></span>';
  try{
    const r=await api('POST','/auth/verify-otp',{phone:p,otp:en});
    aT=r.token;cU=r.user;localStorage.setItem('cbT',aT);localStorage.setItem('cbP',p);
    $('otpErr').style.display='none';await loadRecs();loadHome();scr('s-home');toast('👋 Welcome back!');
    await syncOfflineQueue();
  }catch(e){$('otpErr').style.display='block';bs.forEach(b=>{b.value='';b.classList.remove('f');});bs[0].focus();}
  btn.disabled=false;btn.innerHTML='Verify & Login';
};
window.backPhone=function(){$('phoneStep').style.display='block';$('otpStep').style.display='none';$('authSub').textContent='Enter your mobile number to login or create your account.';if(oTmr)clearInterval(oTmr);};
window.logout=function(){aT=null;cU=null;recs=[];localStorage.removeItem('cbT');localStorage.removeItem('cbP');scr('s-auth');$('authPhone').value='';$('phoneStep').style.display='block';$('otpStep').style.display='none';toast('Logged out');};

// ── DATA ──────────────────────────────────────────────────────────────
async function loadRecs(){if(!cU)return;try{recs=await api('GET','/redemptions/'+cU.phone);}catch{recs=[];}}
function loadHome(){
  if(!cU)return;
  const pa=recs.filter(r=>r.status==='paid').reduce((s,r)=>s+(r.amount||0),0);
  const ta=recs.reduce((s,r)=>s+(r.amount||0),0);
  const i=(cU.name||'U')[0].toUpperCase();
  $('hAv').textContent=$('pAv').textContent=i;
  $('pNm').textContent=cU.name;$('pPh').textContent='+91 '+cU.phone;
  $('hAmt').innerHTML='₹'+ta.toLocaleString('en-IN')+'<br><span style="font-size:.9rem;font-weight:500;opacity:.8">Total Submitted</span>';
  $('sSub').textContent=recs.length;$('sPaid').textContent='₹'+pa.toLocaleString('en-IN');
  const el=$('recent'),r=recs.slice(0,3);
  el.innerHTML=!r.length?'<div class="es"><span class="ei">🎟️</span><div class="et">No coupons yet</div><div class="em">Submit your first coupon!</div></div>':r.map(hCard).join('');
}
window.renderHist=function(){
  const f=$('hFil').value,r=f==='all'?recs:recs.filter(x=>x.status===f);
  $('histList').innerHTML=!r.length?'<div class="es"><span class="ei">📜</span><div class="et">No records</div><div class="em">Nothing to show here</div></div>':r.map(hCard).join('');
};
function hCard(r){
  const sm={pending:'<span class="badge b2">⏳ Pending</span>',paid:'<span class="badge b3">✅ Paid</span>',review:'<span class="badge b1">🔍 In Review</span>'};
  const bg=r.status==='paid'?'background:#e6faf2':r.status==='pending'?'background:#fff5e6':'background:#eef0ff';
  return \`<div class="hi"><div class="hii" style="\${bg}">\${r.companyIcon||'🎟️'}</div><div class="hin"><div class="hic">\${r.code}</div><div class="hico">\${r.company||'—'} · \${r.source||'—'}</div><div class="him">\${r.date}</div></div><div class="hir"><div class="hia">\${r.amount?'₹'+r.amount.toLocaleString('en-IN'):'—'}</div>\${sm[r.status]||sm.review}</div></div>\`;
}
window.selCo=function(n,ic){$('rCo').value=n;selIcon=ic;document.querySelectorAll('#chips .chip').forEach(c=>c.classList.remove('s'));event.currentTarget.classList.add('s');};
window.fChips=function(v){document.querySelectorAll('#chips .chip').forEach(c=>{c.style.display=!v||c.textContent.toLowerCase().includes(v.toLowerCase())?'':'none';});};
window.selSrc=function(el,v){document.querySelectorAll('.sg .sbn').forEach(b=>b.classList.remove('s'));el.classList.add('s');selSrc2=v;};
window.addUPI=function(s){const i=$('rUPI');i.value=(i.value.includes('@')?i.value.split('@')[0]:i.value)+s;i.focus();};
window.submitCoupon=async function(){
  let ok=true;
  const se=(id,eid,v)=>{$(id).classList.toggle('err',!v);$(eid).style.display=v?'none':'block';if(!v)ok=false;};
  const co=$('rCo').value.trim(),cd=$('rCode').value.trim(),up=$('rUPI').value.trim();
  se('rCo','coErr',co.length>=1);
  if(!cd){$('rCode').classList.add('err');$('codeErr').style.display='block';ok=false;}else{$('rCode').classList.remove('err');$('codeErr').style.display='none';}
  if(!selSrc2){$('srcErr').style.display='block';ok=false;}else{$('srcErr').style.display='none';}
  se('rUPI','upiErr',up.includes('@')&&up.length>=5);
  if(!ok){toast('⚠️ Please fill all fields');return;}
  const btn=$('subBtn');btn.disabled=true;btn.innerHTML='<span class="sp"></span> Submitting…';
  const payload={company:co,code:cd.toUpperCase(),upi:up,source:selSrc2,companyIcon:selIcon};
  try{
    let rec;
    if(!navigator.onLine){
      await queueOfflineSubmission(payload);
      rec={...payload,id:'offline-'+Date.now(),status:'review',date:'Queued (offline)',amount:null,phone:cU.phone,name:cU.name,ts:Date.now()};
      recs.unshift(rec);toast('📡 Saved offline — will sync when connected');
      if('serviceWorker' in navigator&&'SyncManager' in window){
        const reg=await navigator.serviceWorker.ready;
        await reg.sync.register('sync-pending-submissions');
      }
    } else {
      rec=await api('POST','/redemptions',payload);
      recs.unshift(rec);
    }
    $('rForm').style.display='none';$('rOk').style.display='flex';
    $('okTable').innerHTML=\`<div class="dr"><span class="dl">Company</span><span class="dv">\${co}</span></div><div class="dr"><span class="dl">Code</span><span class="dv bl2">\${cd.toUpperCase()}</span></div><div class="dr"><span class="dl">UPI</span><span class="dv">\${up}</span></div><div class="dr"><span class="dl">Source</span><span class="dv">\${selSrc2}</span></div><div class="dr"><span class="dl">Date</span><span class="dv">\${rec.date}</span></div><div class="dr"><span class="dl">Status</span><span class="dv bl2">🔍 In Review</span></div>\`;
    loadHome();
  }catch(e){toast('❌ '+e.message);}
  btn.disabled=false;btn.innerHTML='Submit for Review →';
};
window.another=function(){$('rForm').style.display='flex';$('rOk').style.display='none';['rCode','rCo','rUPI'].forEach(id=>$(id).value='');document.querySelectorAll('.sg .sbn,#chips .chip').forEach(b=>b.classList.remove('s'));selSrc2='';selIcon='🏢';};
window.gTab=function(t){
  const m={home:'s-home',redeem:'s-redeem',history:'s-history',profile:'s-profile'};
  scr(m[t]);
  document.querySelectorAll('.bn .bi').forEach(b=>{const l=b.querySelector('.bil')?.textContent?.toLowerCase();b.classList.toggle('on',l===t);});
  if(t==='history'){loadRecs().then(renderHist);}if(t==='home')loadHome();
};
window.requestNotifPerm=requestNotifPerm;
(async()=>{
  const t=localStorage.getItem('cbT'),p=localStorage.getItem('cbP');
  if(t&&p){aT=t;try{cU=await api('GET','/users/'+p);await loadRecs();loadHome();scr('s-home');return;}catch{localStorage.removeItem('cbT');localStorage.removeItem('cbP');}}
  scr('s-auth');
})();
</script>
</body></html>`;

// ══════════════════════════════════════════════════════════════════════
//  ADMIN HTML  (same as before — full panel)
// ══════════════════════════════════════════════════════════════════════
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#4361ee">
<title>CashBack Pro – Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\/script>
<style>
:root{--bg:#f0f4ff;--w:#fff;--sf:#f7f9ff;--pr:#4361ee;--prl:#eef0ff;--gr:#06c270;--grl:#e6faf2;--am:#ff9f1c;--aml:#fff5e6;--re:#f7263e;--rel:#fff0f2;--tx:#0d1117;--sb:#4a5568;--mu:#94a3b8;--bo:#e2e8f0;--ra:14px;--sh:0 4px 24px rgba(67,97,238,.1);}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Plus Jakarta Sans',sans-serif;background:var(--bg);color:var(--tx);min-height:100vh}
#lw{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;background:linear-gradient(135deg,#f0f4ff,#e8ecff)}
.lc{background:#fff;border-radius:24px;padding:44px 40px;width:100%;max-width:400px;box-shadow:0 20px 80px rgba(67,97,238,.13);text-align:center}
.llo{width:60px;height:60px;background:linear-gradient(135deg,#4361ee,#7b2ff7);border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:1.8rem;margin:0 auto 18px}
.lt{font-size:1.4rem;font-weight:800;margin-bottom:5px}.ls{font-size:.86rem;color:var(--mu);margin-bottom:28px}
.li{width:100%;background:var(--sf);border:1.5px solid var(--bo);border-radius:var(--ra);padding:13px 15px;font-family:inherit;font-size:.92rem;color:var(--tx);outline:none;transition:all .22s;margin-bottom:12px}
.li:focus{border-color:var(--pr);box-shadow:0 0 0 3px rgba(67,97,238,.08)}
.lb{width:100%;padding:14px;background:linear-gradient(135deg,#4361ee,#7b2ff7);color:#fff;border:none;border-radius:var(--ra);font-family:inherit;font-weight:700;font-size:.92rem;cursor:pointer;transition:all .25s}
.lb:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(67,97,238,.32)}.le{color:var(--re);font-size:.78rem;margin-top:8px;display:none}.lh{font-size:.72rem;color:var(--mu);margin-top:14px}
#aw{display:none}.sb2{width:215px;background:#fff;border-right:1px solid var(--bo);min-height:100vh;position:fixed;top:0;left:0;display:flex;flex-direction:column;padding:22px 0;box-shadow:2px 0 18px rgba(0,0,0,.04)}
.sbl{display:flex;align-items:center;gap:10px;padding:0 18px 24px;border-bottom:1px solid var(--bo);margin-bottom:14px}
.sbli{width:36px;height:36px;background:linear-gradient(135deg,#4361ee,#7b2ff7);border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
.sbln{font-weight:800;font-size:.92rem}.sblt{font-size:.58rem;font-weight:700;color:var(--pr);background:var(--prl);border-radius:4px;padding:1px 5px;letter-spacing:.5px}
.si{display:flex;align-items:center;gap:9px;padding:10px 18px;cursor:pointer;transition:all .18s;font-size:.86rem;font-weight:600;color:var(--sb);border-right:3px solid transparent;margin:1px 0}
.si:hover{background:var(--sf);color:var(--tx)}.si.ac{background:var(--prl);color:var(--pr);border-right-color:var(--pr)}.sic{font-size:1.05rem;width:20px;text-align:center}
.slo{margin-top:auto;border-top:1px solid var(--bo);padding-top:14px}.slo .si{color:var(--re)}
.mc{margin-left:215px;padding:26px;min-height:100vh}.pt{font-size:1.25rem;font-weight:800;margin-bottom:5px}.ps{font-size:.83rem;color:var(--mu);margin-bottom:22px}
.sg2{display:grid;grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:12px;margin-bottom:24px}
.sc{background:#fff;border:1px solid var(--bo);border-radius:var(--ra);padding:18px;box-shadow:var(--sh);transition:transform .22s}.sc:hover{transform:translateY(-2px)}
.sci{font-size:1.4rem;margin-bottom:8px;display:block}.scv{font-size:1.5rem;font-weight:800}.scv.g{color:var(--gr)}.scv.a{color:var(--am)}.scv.b{color:var(--pr)}
.scl{font-size:.7rem;color:var(--mu);font-weight:600;margin-top:2px;letter-spacing:.5px;text-transform:uppercase}
.ld{width:7px;height:7px;border-radius:50%;background:var(--gr);display:inline-block;margin-left:7px;animation:pu 2s infinite}@keyframes pu{0%,100%{opacity:1}50%{opacity:.4}}
.card{background:#fff;border:1px solid var(--bo);border-radius:18px;overflow:hidden;box-shadow:var(--sh);margin-bottom:22px}
.ch{padding:16px 20px;border-bottom:1px solid var(--bo);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:9px}
.cht{font-weight:800;font-size:.92rem}.tb{display:flex;gap:9px;flex-wrap:wrap;align-items:center}
.ti{background:var(--sf);border:1.5px solid var(--bo);border-radius:var(--ra);padding:8px 12px;font-family:inherit;font-size:.8rem;color:var(--tx);outline:none;transition:border-color .2s}
.ti:focus{border-color:var(--pr)}.ti::placeholder{color:var(--mu)}
.ts{background:var(--sf);border:1.5px solid var(--bo);border-radius:var(--ra);padding:8px 11px;font-family:inherit;font-size:.8rem;color:var(--sb);outline:none;cursor:pointer}
.tbtn{display:flex;align-items:center;gap:5px;padding:8px 14px;border-radius:var(--ra);font-family:inherit;font-weight:700;font-size:.78rem;cursor:pointer;border:none;transition:all .18s;white-space:nowrap}
.tp{background:linear-gradient(135deg,#4361ee,#7b2ff7);color:#fff}.tp:hover{transform:translateY(-1px);box-shadow:0 5px 18px rgba(67,97,238,.28)}
.tr2{background:var(--rel);color:var(--re);border:1px solid rgba(247,38,62,.15)}.tr2:hover{background:rgba(247,38,62,.15)}
table{width:100%;border-collapse:collapse}thead th{padding:11px 13px;text-align:left;font-size:.66rem;font-weight:700;color:var(--mu);letter-spacing:1.5px;text-transform:uppercase;background:var(--sf);border-bottom:1px solid var(--bo);white-space:nowrap}
tbody tr{border-bottom:1px solid var(--bo);transition:background .12s}tbody tr:last-child{border-bottom:none}tbody tr:hover{background:#fafbff}
td{padding:12px 13px;font-size:.82rem;vertical-align:middle}
.tn{font-weight:700}.tp2,.tdd{color:var(--mu);font-size:.76rem}.tu{font-size:.76rem;color:var(--pr)}.tc{font-weight:800;font-size:.78rem;letter-spacing:1.5px;color:var(--am)}.tco{font-size:.78rem;font-weight:600}
.tsr{font-size:.7rem;background:var(--prl);color:var(--pr);border-radius:6px;padding:2px 7px}
.ai2{width:80px;background:var(--sf);border:1.5px solid var(--bo);border-radius:7px;padding:5px 8px;font-family:inherit;font-size:.82rem;font-weight:700;color:var(--tx);outline:none;text-align:center}
.ai2:focus{border-color:var(--gr)}.sav{padding:4px 9px;background:var(--grl);border:1px solid rgba(6,194,112,.2);border-radius:7px;color:var(--gr);font-size:.7rem;font-weight:700;cursor:pointer;margin-left:3px}
.stb{display:inline-flex;align-items:center;gap:3px;padding:3px 10px;border-radius:50px;font-size:.68rem;font-weight:700;cursor:pointer;transition:all .18s;white-space:nowrap;border:none;font-family:inherit}
.st1{background:var(--prl);color:var(--pr);border:1px solid rgba(67,97,238,.2)}.st2{background:var(--aml);color:var(--am);border:1px solid rgba(255,159,28,.2)}.st3{background:var(--grl);color:var(--gr);border:1px solid rgba(6,194,112,.2)}
.db{background:var(--rel);border:1px solid rgba(247,38,62,.15);color:var(--re);border-radius:7px;padding:4px 9px;cursor:pointer;font-size:.7rem;font-weight:700}
.ec{padding:50px;text-align:center;color:var(--mu)}.uav{width:26px;height:26px;border-radius:50%;background:var(--prl);display:inline-flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;color:var(--pr);margin-right:7px;vertical-align:middle}
.pi{background:var(--sf);border:1.5px solid var(--bo);border-radius:var(--ra);padding:10px 13px;font-family:inherit;font-size:.86rem;color:var(--tx);outline:none;transition:all .2s;width:100%}
.pi:focus{border-color:var(--pr)}.pm{font-size:.76rem;margin-top:8px}.pm.ok{color:var(--gr)}.pm.er{color:var(--re)}
@media(max-width:900px){.sb2{display:none}.mc{margin-left:0;padding:14px}}
</style>
</head>
<body>
<div id="lw"><div class="lc"><div class="llo">💸</div><h2 class="lt">Admin Dashboard</h2><p class="ls">CashBack Pro · Business Control Panel</p><input class="li" type="text" id="lu" placeholder="Username" onkeydown="if(event.key==='Enter')document.getElementById('lp').focus()"><input class="li" type="password" id="lp" placeholder="Password" onkeydown="if(event.key==='Enter')login()"><button class="lb" onclick="login()">Login to Dashboard →</button><p class="le" id="lerr">❌ Invalid credentials</p><p class="lh">Default: <strong>admin</strong> / <strong>admin123</strong></p></div></div>
<div id="aw">
  <div class="sb2"><div class="sbl"><div class="sbli">💸</div><div><div class="sbln">CashBack Pro</div><div class="sblt">ADMIN</div></div></div><div class="si ac" onclick="pg('dashboard')"><span class="sic">📊</span>Dashboard</div><div class="si" onclick="pg('redemptions')"><span class="sic">🎟️</span>Redemptions</div><div class="si" onclick="pg('users')"><span class="sic">👥</span>Users</div><div class="si" onclick="pg('settings')"><span class="sic">⚙️</span>Settings</div><div class="slo"><div class="si" onclick="alogout()"><span class="sic">🚪</span>Logout</div></div></div>
  <div class="mc">
    <div id="p-dashboard"><div class="pt">Dashboard <span class="ld"></span></div><div class="ps" id="dDate"></div><div class="sg2"><div class="sc"><span class="sci">📋</span><div class="scv b" id="sv1">—</div><div class="scl">Total Submissions</div></div><div class="sc"><span class="sci">🔍</span><div class="scv b" id="sv2">—</div><div class="scl">In Review</div></div><div class="sc"><span class="sci">⏳</span><div class="scv a" id="sv3">—</div><div class="scl">Pending Payment</div></div><div class="sc"><span class="sci">✅</span><div class="scv g" id="sv4">—</div><div class="scl">Paid Out</div></div><div class="sc"><span class="sci">💰</span><div class="scv g" id="sv5">—</div><div class="scl">Total Payout</div></div><div class="sc"><span class="sci">👥</span><div class="scv b" id="sv6">—</div><div class="scl">Registered Users</div></div></div><div class="card"><div class="ch"><span class="cht">Recent Submissions</span><button class="tbtn tp" onclick="pg('redemptions')">View All →</button></div><div style="overflow-x:auto"><table><thead><tr><th>User</th><th>Company</th><th>Code</th><th>Amount</th><th>Status</th></tr></thead><tbody id="rTbl"></tbody></table></div></div></div>
    <div id="p-redemptions" style="display:none"><div class="pt">All Redemptions <span class="ld"></span></div><div class="ps">Review, set amounts, and approve submissions from all users</div><div class="card"><div class="ch"><div class="tb"><input class="ti" id="srch" placeholder="🔍 Search name, phone, code…" oninput="rTbl()" style="min-width:220px"><select class="ts" id="stF" onchange="rTbl()"><option value="all">All Status</option><option value="review">In Review</option><option value="pending">Pending</option><option value="paid">Paid</option></select><select class="ts" id="coF" onchange="rTbl()"><option value="all">All Companies</option></select></div><div style="display:flex;gap:7px"><button class="tbtn tp" onclick="exportXlsx()">📊 Export Excel</button><button class="tbtn tr2" onclick="clearAll()">🗑 Clear All</button></div></div><div style="overflow-x:auto"><table><thead><tr><th>#</th><th>User</th><th>Mobile</th><th>UPI</th><th>Company</th><th>Source</th><th>Code</th><th>Amount ₹</th><th>Date</th><th>Status</th><th>Action</th></tr></thead><tbody id="mTbl"></tbody></table></div></div></div>
    <div id="p-users" style="display:none"><div class="pt">Registered Users</div><div class="ps">All users who signed up via OTP</div><div class="card"><div class="ch"><span class="cht">User Accounts</span><span id="uCnt" style="font-size:.78rem;color:var(--mu)"></span></div><div style="overflow-x:auto"><table><thead><tr><th>User</th><th>Phone</th><th>Joined</th><th>Submissions</th><th>Total Value</th></tr></thead><tbody id="uTbl"></tbody></table></div></div></div>
    <div id="p-settings" style="display:none"><div class="pt">Settings</div><div class="ps">Admin credentials & configuration</div><div class="card"><div class="ch"><span class="cht">🔐 Change Password</span></div><div style="padding:18px 20px"><div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:9px;align-items:end;flex-wrap:wrap"><div><label style="font-size:.7rem;font-weight:700;color:var(--mu);text-transform:uppercase;display:block;margin-bottom:4px">Current</label><input class="pi" type="password" id="pwC" placeholder="Current password"></div><div><label style="font-size:.7rem;font-weight:700;color:var(--mu);text-transform:uppercase;display:block;margin-bottom:4px">New</label><input class="pi" type="password" id="pwN" placeholder="Min 6 chars"></div><div><label style="font-size:.7rem;font-weight:700;color:var(--mu);text-transform:uppercase;display:block;margin-bottom:4px">Confirm</label><input class="pi" type="password" id="pwCf" placeholder="Repeat new"></div><div><label style="font-size:.7rem;color:transparent;display:block;margin-bottom:4px">_</label><button class="tbtn tp" onclick="chPw()" style="height:40px;width:100%">Update</button></div></div><div class="pm" id="pwMsg"></div></div></div><div class="card" style="margin-top:14px"><div class="ch"><span class="cht">👤 Change Username</span></div><div style="padding:18px 20px"><div style="display:flex;gap:9px;align-items:flex-end;flex-wrap:wrap"><div style="flex:1"><label style="font-size:.7rem;font-weight:700;color:var(--mu);text-transform:uppercase;display:block;margin-bottom:4px">New Username</label><input class="pi" type="text" id="newU" placeholder="Enter new username"></div><button class="tbtn tp" onclick="chUn()" style="height:40px">Save</button></div><div class="pm" id="unMsg"></div></div></div></div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);let allR=[],allU={},aT=null;
async function aApi(m,p,b){const o={method:m,headers:{'Content-Type':'application/json'}};if(aT)o.headers['Authorization']='Bearer '+aT;if(b)o.body=JSON.stringify(b);const r=await fetch('/api'+p,o);const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');return d;}
window.login=async function(){const u=$('lu').value.trim(),p=$('lp').value;try{const r=await aApi('POST','/admin/login',{user:u,pass:p});aT=r.token;sessionStorage.setItem('aT',aT);$('lw').style.display='none';$('aw').style.display='block';init();}catch(e){$('lerr').style.display='block';$('lp').value='';}};
window.alogout=function(){aT=null;sessionStorage.removeItem('aT');$('lw').style.display='flex';$('aw').style.display='none';$('lu').value='';$('lp').value='';$('lerr').style.display='none';};
function init(){$('dDate').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',year:'numeric',month:'long',day:'numeric'});refresh();setInterval(refresh,15000);}
async function refresh(){try{const[st,rd,us]=await Promise.all([aApi('GET','/admin/stats'),aApi('GET','/admin/redemptions'),aApi('GET','/admin/users')]);allR=rd.redemptions||[];allU=us.users||{};$('sv1').textContent=st.totalSubmissions;$('sv2').textContent=st.byStatus.review;$('sv3').textContent=st.byStatus.pending;$('sv4').textContent=st.byStatus.paid;$('sv5').textContent='₹'+st.totalAmountPaid.toLocaleString('en-IN');$('sv6').textContent=st.totalUsers;rRecent();rTbl();fillCoF();}catch(e){console.error('refresh',e);}}
window.pg=function(id){['dashboard','redemptions','users','settings'].forEach(p=>$('p-'+p).style.display='none');$('p-'+id).style.display='block';document.querySelectorAll('.sb2 .si').forEach(i=>i.classList.remove('ac'));const m={dashboard:0,redemptions:1,users:2,settings:3};document.querySelectorAll('.sb2 .si')[m[id]]?.classList.add('ac');if(id==='users')rUsers();};
function rRecent(){$('rTbl').innerHTML=allR.slice(0,5).map(r=>\`<tr><td class="tn">\${r.name||'—'}</td><td class="tco">\${r.company||'—'}</td><td class="tc">\${r.code}</td><td style="font-weight:700;color:var(--gr)">\${r.amount?'₹'+r.amount:'—'}</td><td>\${stB(r.status,null)}</td></tr>\`).join('')||'<tr><td colspan="5" class="ec">No submissions yet</td></tr>';}
function fillCoF(){const cs=[...new Set(allR.map(r=>r.company).filter(Boolean))];const s=$('coF');const cv=s.value;s.innerHTML='<option value="all">All Companies</option>';cs.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;if(c===cv)o.selected=true;s.appendChild(o);});}
window.rTbl=function(){const q=($('srch')?.value||'').toLowerCase(),sf=$('stF')?.value||'all',cf=$('coF')?.value||'all';let d=[...allR];if(q)d=d.filter(r=>[r.name,r.phone,r.code,r.company,r.upi].some(v=>(v||'').toLowerCase().includes(q)));if(sf!=='all')d=d.filter(r=>r.status===sf);if(cf!=='all')d=d.filter(r=>r.company===cf);$('mTbl').innerHTML=!d.length?'<tr><td colspan="11" class="ec">No records match</td></tr>':d.map((r,i)=>{const idx=allR.findIndex(x=>x.id===r.id);return \`<tr><td style="color:var(--mu);font-size:.72rem">\${i+1}</td><td class="tn">\${r.name||'—'}</td><td class="tp2">\${r.phone||'—'}</td><td class="tu">\${r.upi||'—'}</td><td class="tco">\${r.company||'—'}</td><td><span class="tsr">\${r.source||'—'}</span></td><td class="tc">\${r.code}</td><td style="white-space:nowrap"><input class="ai2" type="number" value="\${r.amount||''}" placeholder="₹" id="a\${idx}" min="0"><button class="sav" onclick="sAmt('\${r.id}',\${idx})">✓ Save</button></td><td class="tdd">\${r.date||'—'}</td><td>\${stB(r.status,r.id)}</td><td><button class="db" onclick="dRec('\${r.id}')">Delete</button></td></tr>\`;}).join('');};
function stB(s,id){const m={review:'🔍 In Review',pending:'⏳ Pending',paid:'✅ Paid'};const c={review:'st1',pending:'st2',paid:'st3'};const oc=id?\`onclick="cyS('\${id}')"\`:'';return \`<button class="stb \${c[s]||'st1'}" \${oc}>\${m[s]||'🔍 In Review'}</button>\`;}
window.cyS=async function(id){const r=allR.find(x=>x.id===id);if(!r)return;const cy={review:'pending',pending:'paid',paid:'review'};try{await aApi('PATCH','/redemptions/'+id,{status:cy[r.status]||'pending'});await refresh();}catch(e){alert('Failed: '+e.message);}};
window.sAmt=async function(id,idx){const v=parseFloat($('a'+idx)?.value);if(isNaN(v)||v<0)return;const r=allR[idx];if(!r)return;const ns=r.status==='review'?'pending':r.status;try{await aApi('PATCH','/redemptions/'+id,{amount:v,status:ns});await refresh();}catch(e){alert('Failed: '+e.message);}};
window.dRec=async function(id){if(!confirm('Delete this record?'))return;try{await aApi('DELETE','/redemptions/'+id);await refresh();}catch(e){alert('Failed: '+e.message);}};
window.clearAll=async function(){if(!confirm('⚠️ Delete ALL records? Cannot be undone!'))return;try{await Promise.all(allR.map(r=>aApi('DELETE','/redemptions/'+r.id)));await refresh();}catch(e){alert('Failed: '+e.message);}};
function rUsers(){const es=Object.values(allU);$('uCnt').textContent=es.length+' users';$('uTbl').innerHTML=!es.length?'<tr><td colspan="5" class="ec">No users yet</td></tr>':es.map(u=>{const ur=allR.filter(r=>r.phone===u.phone);const tot=ur.reduce((s,r)=>s+(r.amount||0),0);return \`<tr><td><span class="uav">\${(u.name||'U')[0]}</span><strong>\${u.name||'—'}</strong></td><td class="tp2">\${u.phone}</td><td class="tdd">\${u.joinDate||'—'}</td><td style="font-weight:700;color:var(--pr)">\${ur.length}</td><td style="font-weight:700;color:var(--gr)">\${tot?'₹'+tot.toLocaleString('en-IN'):'₹0'}</td></tr>\`;}).join('');}
window.exportXlsx=function(){if(!allR.length){alert('No records!');return;}const rows=allR.map((r,i)=>({'#':i+1,Name:r.name||'',Mobile:r.phone||'',UPI:r.upi||'',Company:r.company||'',Source:r.source||'','Coupon Code':r.code||'','Amount ₹':r.amount||0,Date:r.date||'',Status:r.status==='paid'?'Paid':r.status==='pending'?'Pending':'In Review'}));const ws=XLSX.utils.json_to_sheet(rows);ws['!cols']=[{wch:4},{wch:18},{wch:14},{wch:22},{wch:16},{wch:16},{wch:16},{wch:12},{wch:22},{wch:12}];const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Redemptions');const byC={};allR.forEach(r=>{const c=r.company||'Unknown';if(!byC[c])byC[c]={n:0,t:0};byC[c].n++;byC[c].t+=r.amount||0;});const ws2=XLSX.utils.aoa_to_sheet([['Company','Submissions','Total ₹'],...Object.entries(byC).map(([c,v])=>[c,v.n,v.t])]);XLSX.utils.book_append_sheet(wb,ws2,'By Company');XLSX.utils.writeFile(wb,'CashBackPro_'+new Date().toISOString().slice(0,10)+'.xlsx');};
window.chPw=async function(){const c=$('pwC').value,n=$('pwN').value,cf=$('pwCf').value,msg=$('pwMsg');if(n.length<6){msg.className='pm er';msg.textContent='❌ Min 6 characters.';return;}if(n!==cf){msg.className='pm er';msg.textContent='❌ Passwords do not match.';return;}try{await aApi('POST','/admin/config',{currentPass:c,newPass:n});msg.className='pm ok';msg.textContent='✅ Password updated!';['pwC','pwN','pwCf'].forEach(id=>$(id).value='');}catch(e){msg.className='pm er';msg.textContent='❌ '+e.message;}};
window.chUn=async function(){const u=$('newU').value.trim(),msg=$('unMsg');if(u.length<3){msg.className='pm er';msg.textContent='❌ Min 3 characters.';return;}try{await aApi('POST','/admin/config',{newUser:u});msg.className='pm ok';msg.textContent='✅ Username updated to "'+u+'"!';$('newU').value='';}catch(e){msg.className='pm er';msg.textContent='❌ '+e.message;}};
(async()=>{const t=sessionStorage.getItem('aT');if(t){aT=t;try{await refresh();$('lw').style.display='none';$('aw').style.display='block';init();}catch{sessionStorage.removeItem('aT');}}})();
<\/script></body></html>`;

// ══════════════════════════════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════════════════════════════
async function router(req, res) {
  const raw=req.url; const url=raw.split('?')[0].replace(/\/$/,'')||'/'; const m=req.method.toUpperCase();
  if(m==='OPTIONS'){res.writeHead(204,CORS);return res.end();}
  if(serveStatic(req,res))return;
  if((url==='/'||url==='/index.html')&&m==='GET')return hRes(res,USER_HTML);
  if((url==='/admin'||url==='/admin/index.html')&&m==='GET')return hRes(res,ADMIN_HTML);
  if(url==='/api/health'&&m==='GET')return jRes(res,200,{status:'ok',users:Object.keys(DB.users).length,redemptions:Object.keys(DB.redemptions).length,uptime:process.uptime()});
  if(url==='/api/auth/send-otp'&&m==='POST'){const{phone}=await body(req);if(!phone||!/^\d{10}$/.test(phone))return jRes(res,400,{error:'Invalid phone'});const otp=String(Math.floor(1000+Math.random()*9000));DB.otps[phone]={otp,ts:Date.now()};saveDB();sendOTPSMS(phone,otp);const smsConfigured=!!(process.env.SMS_API_KEY||process.env.MSG91_KEY||process.env.FAST2SMS_KEY);return jRes(res,200,{message:'OTP sent',...(!smsConfigured&&{dev_otp:otp})});}
  if(url==='/api/auth/verify-otp'&&m==='POST'){const{phone,otp}=await body(req);if(!phone||!otp)return jRes(res,400,{error:'phone and otp required'});const rec=DB.otps[phone];if(!rec)return jRes(res,401,{error:'No OTP found'});if(Date.now()-rec.ts>OTP_TTL)return jRes(res,401,{error:'OTP expired'});if(rec.otp!==String(otp))return jRes(res,401,{error:'Incorrect OTP'});delete DB.otps[phone];if(!DB.users[phone])DB.users[phone]={phone,name:'User '+phone.slice(-4),joinDate:new Date().toLocaleDateString('en-IN'),ts:Date.now()};saveDB();const user=DB.users[phone];return jRes(res,200,{token:signJWT({phone,name:user.name,role:'user'},JWT_TTL),user});}
  if(url==='/api/admin/login'&&m==='POST'){const{user,pass}=await body(req);if(user!==DB.adminConfig.user||pass!==DB.adminConfig.pass)return jRes(res,401,{error:'Invalid admin credentials'});return jRes(res,200,{token:signJWT({role:'admin',user},ADM_TTL),message:'Login successful'});}
  const uM=url.match(/^\/api\/users\/(\d{10})$/);
  if(uM&&m==='GET'){const a=getAuth(req);if(!a)return jRes(res,401,{error:'Unauthorized'});if(a.phone!==uM[1]&&!isAdmin(req))return jRes(res,403,{error:'Forbidden'});const u=DB.users[uM[1]];if(!u)return jRes(res,404,{error:'User not found'});return jRes(res,200,u);}
  if(url==='/api/users'&&m==='POST'){const a=getAuth(req);if(!a)return jRes(res,401,{error:'Unauthorized'});const b2=await body(req);const u=DB.users[a.phone];if(!u)return jRes(res,404,{error:'User not found'});if(b2.name)u.name=b2.name;if(b2.upi)u.upi=b2.upi;u.updatedAt=Date.now();saveDB();return jRes(res,200,u);}
  if(url==='/api/redemptions'&&m==='POST'){const a=getAuth(req);if(!a)return jRes(res,401,{error:'Unauthorized'});const b2=await body(req);const{company,code,upi,source,companyIcon}=b2;if(!company||!code||!upi||!source)return jRes(res,400,{error:'company, code, upi, source required'});if(!upi.includes('@')||upi.length<5)return jRes(res,400,{error:'Invalid UPI ID'});const now=new Date();const id='r'+Date.now()+Math.random().toString(36).slice(2,7);const rec={id,phone:a.phone,name:a.name,company,companyIcon:companyIcon||'🏢',code:code.toUpperCase(),upi,source,amount:null,status:'review',date:now.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})+' '+now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}),ts:Date.now()};DB.redemptions[id]=rec;saveDB();return jRes(res,201,rec);}
  const rByP=url.match(/^\/api\/redemptions\/(\d{10})$/);
  if(rByP&&m==='GET'){const a=getAuth(req);if(!a)return jRes(res,401,{error:'Unauthorized'});if(a.phone!==rByP[1]&&!isAdmin(req))return jRes(res,403,{error:'Forbidden'});return jRes(res,200,Object.values(DB.redemptions).filter(r=>r.phone===rByP[1]).sort((a,b)=>(b.ts||0)-(a.ts||0)));}
  const rById=url.match(/^\/api\/redemptions\/([a-z0-9]+)$/);
  if(rById&&m==='PATCH'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});const rec=DB.redemptions[rById[1]];if(!rec)return jRes(res,404,{error:'Not found'});const b2=await body(req);if(b2.status!==undefined){if(!['review','pending','paid','rejected'].includes(b2.status))return jRes(res,400,{error:'Invalid status'});rec.status=b2.status;}if(b2.amount!==undefined)rec.amount=Number(b2.amount)||null;rec.updatedAt=Date.now();saveDB();return jRes(res,200,rec);}
  if(rById&&m==='DELETE'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});if(!DB.redemptions[rById[1]])return jRes(res,404,{error:'Not found'});delete DB.redemptions[rById[1]];saveDB();return jRes(res,200,{message:'Deleted'});}
  if(url.startsWith('/api/admin/redemptions')&&m==='GET'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});const qs=raw.includes('?')?raw.split('?')[1]:'';const p=Object.fromEntries(new URLSearchParams(qs));let r=Object.values(DB.redemptions).sort((a,b)=>(b.ts||0)-(a.ts||0));if(p.status)r=r.filter(x=>x.status===p.status);if(p.phone)r=r.filter(x=>x.phone===p.phone);return jRes(res,200,{count:r.length,redemptions:r});}
  if(url==='/api/admin/users'&&m==='GET'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});return jRes(res,200,{count:Object.keys(DB.users).length,users:DB.users});}
  if(url==='/api/admin/stats'&&m==='GET'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});const r=Object.values(DB.redemptions);const paid=r.filter(x=>x.status==='paid');return jRes(res,200,{totalUsers:Object.keys(DB.users).length,totalSubmissions:r.length,byStatus:{review:r.filter(x=>x.status==='review').length,pending:r.filter(x=>x.status==='pending').length,paid:paid.length,rejected:r.filter(x=>x.status==='rejected').length},totalAmountPaid:paid.reduce((s,x)=>s+(x.amount||0),0),recentSubmissions:r.slice(0,10)});}
  if(url==='/api/admin/config'&&m==='GET'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});return jRes(res,200,{user:DB.adminConfig.user});}
  if(url==='/api/admin/config'&&m==='POST'){if(!isAdmin(req))return jRes(res,403,{error:'Admin required'});const b2=await body(req);if(b2.newPass){if(b2.currentPass!==DB.adminConfig.pass)return jRes(res,401,{error:'Current password wrong'});if(b2.newPass.length<6)return jRes(res,400,{error:'Min 6 characters'});DB.adminConfig.pass=b2.newPass;}if(b2.newUser){if(b2.newUser.length<3)return jRes(res,400,{error:'Min 3 characters'});DB.adminConfig.user=b2.newUser;}saveDB();return jRes(res,200,{message:'Updated',user:DB.adminConfig.user});}
  // Push subscription storage
  if(url==='/api/push/subscribe'&&m==='POST'){const a=getAuth(req);if(!a)return jRes(res,401,{error:'Unauthorized'});const sub=await body(req);DB.pushSubscriptions[a.phone]=sub;saveDB();return jRes(res,200,{message:'Subscribed'});}
  return jRes(res,404,{error:`Not found: ${m} ${url}`});
}

const server=http.createServer(async(req,res)=>{try{await router(req,res);}catch(err){console.error('[Error]',err.message);jRes(res,500,{error:'Server error',detail:err.message});}});
server.listen(PORT,()=>{
  console.log(`
  ╔══════════════════════════════════════════════════════════════════╗
  ║         CashBack Pro PWA — RUNNING ✅                            ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║  User App    ➜  http://localhost:${PORT}                           ║
  ║  Admin Panel ➜  http://localhost:${PORT}/admin                    ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║  PWA Install: open in Chrome → menu → "Add to Home Screen"      ║
  ║  Android:     Chrome shows install banner automatically          ║
  ║  iPhone:      Safari → Share → "Add to Home Screen"             ║
  ╠══════════════════════════════════════════════════════════════════╣
  ║  Admin Login: admin / admin123  (change in Settings)            ║
  ║  Database:    cashback-data.json  (auto-saved)                  ║
  ║  OTP:         printed in this console (dev mode)                ║
  ╚══════════════════════════════════════════════════════════════════╝
  `);
});
