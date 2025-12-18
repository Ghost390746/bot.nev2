import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { checkRateLimit, logAttempt } from './rateLimit.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Inline CAPTCHA verification
async function verifyCaptcha(token, ip) {
  if (!token) return false;
  const secret = process.env.CAPTCHA_SECRET_KEY;
  const res = await fetch('https://hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${secret}&response=${token}&remoteip=${ip}`
  });
  const data = await res.json();
  return data.success === true;
}

// Device fingerprint hash
function getDeviceFingerprint(headers) {
  return crypto.createHash('sha256')
    .update(headers['user-agent'] + headers['accept-language'] + headers['x-forwarded-for'])
    .digest('hex');
}

// Random uniform delay (0.5–1.5s)
async function randomDelay() {
  const delay = 500 + Math.random() * 1000;
  return new Promise(res => setTimeout(res, delay));
}

// Optional: generate encrypted session token
function generateEncryptedToken() {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32),
    iv
  );
  const token = cipher.update(uuidv4(), 'utf8', 'hex') + cipher.final('hex');
  return token;
}

export const handler = async (event) => {
  try {
    const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
    const fingerprint = getDeviceFingerprint(event.headers);

    const { email, password, remember_me, captcha_token, google } = JSON.parse(event.body);

    if (google) {
      return { statusCode: 200, body: JSON.stringify({ success: true, redirect: '/.netlify/functions/googleStart' }) };
    }

    // Adaptive rate limit per IP + email
    const allowed = await checkRateLimit(ip + email);
    if (!allowed) return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Too many login attempts. Try again later.' }) };

    // CAPTCHA verification
    const captchaValid = await verifyCaptcha(captcha_token, ip);
    if (!captchaValid) {
      await logAttempt(ip + email);
      await randomDelay();
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'CAPTCHA verification failed' }) };
    }

    // Fetch user
    const { data: user } = await supabase.from('users').select('*').eq('email', email).maybeSingle();

    // Dummy bcrypt compare for timing attack prevention
    const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO';
    const passwordMatch = user ? await bcrypt.compare(password, user.password) : await bcrypt.compare(password, dummyHash);

    // Check verification, password, device fingerprint, honeytokens, IP risk, etc.
    if (
      !user ||
      !passwordMatch ||
      !user.verified ||
      (user.last_fingerprint && user.last_fingerprint !== fingerprint) ||
      user.is_honeytoken // alert for decoy account login attempt
    ) {
      await logAttempt(ip + email);
      await randomDelay();
      // Optional: trigger email/2FA alert for suspicious activity
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Invalid email or password or device' }) };
    }

    // Generate encrypted session token
    const session_token = generateEncryptedToken();
    const expiresInDays = remember_me ? 90 : 1;

    await supabase.from('sessions').insert({
      user_email: email,
      session_token,
      expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    });

    // Update last fingerprint
    await supabase.from('users').update({ last_fingerprint: fingerprint }).eq('email', email);

    return {
      statusCode: 200,
      headers: {
        'Set-Cookie': `session_token=${session_token}; Path=/; HttpOnly; Secure; Max-Age=${expiresInDays*24*60*60}; SameSite=Strict`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ success: true, message: 'Login successful!' })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error' }) };
  }
};
