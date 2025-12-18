import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Password validation
function validatePassword(password) {
  if (password.length < 30) return false;
  if (!/[A-Z]/.test(password[0])) return false;
  if (!/[0-9]/.test(password.slice(-1))) return false;
  if ((password.match(/[^A-Za-z0-9]/g) || []).length < 2) return false;
  return true;
}

// Device fingerprint hash
function getDeviceFingerprint(headers) {
  return crypto.createHash('sha256')
    .update(headers['user-agent'] + headers['accept-language'])
    .digest('hex');
}

// Random uniform delay (0.5–1.5s)
async function randomDelay() {
  const delay = 500 + Math.random() * 1000;
  return new Promise(res => setTimeout(res, delay));
}

// Generate encrypted verification token
function generateEncryptedToken() {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    crypto.scryptSync(process.env.SESSION_SECRET, 'salt', 32),
    iv
  );
  return cipher.update(uuidv4(), 'utf8', 'hex') + cipher.final('hex');
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: "Method not allowed" }) };
    }

    const { email, username, password, captcha_token } = JSON.parse(event.body || '{}');
    const fingerprint = getDeviceFingerprint(event.headers);

    if (!email || !password) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email and password required.' }) };
    }

    // Optional: CAPTCHA verification for high-risk signups
    if (captcha_token) {
      const secret = process.env.CAPTCHA_SECRET_KEY;
      const res = await fetch('https://hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `secret=${secret}&response=${captcha_token}&remoteip=${event.headers['x-forwarded-for']}`
      });
      const data = await res.json();
      if (!data.success) {
        await randomDelay();
        return { statusCode: 403, body: JSON.stringify({ success: false, error: 'CAPTCHA verification failed' }) };
      }
    }

    // Check if email exists
    const { data: existing } = await supabase
      .from('users')
      .select('email')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      await randomDelay();
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Email already registered.' }) };
    }

    // Validate password
    if (!validatePassword(password)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Password does not meet requirements.' }) };
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Generate encrypted verification token
    const verificationCode = generateEncryptedToken();
    const finalUsername = (username || email.split('@')[0]).trim();

    // Insert user
    const { error: insertError } = await supabase
      .from('users')
      .insert({
        email,
        username: finalUsername,
        password: hashed,
        verified: false,
        verification_code: verificationCode,
        last_fingerprint: fingerprint,
        is_honeytoken: false // set true if creating dummy account
      });

    if (insertError) throw insertError;

    // Send verification email
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn("EMAIL_USER or EMAIL_PASS missing. Verification code logged:");
      console.log(`Verification code for ${email}: ${verificationCode}`);
    } else {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      });

      await transporter.sendMail({
        from: `"Botnev Team" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Your Botnev Verification Code",
        text: `Hello ${finalUsername},\n\nYour verification code is: ${verificationCode}\nUse this code to verify your account.`
      });
    }

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Signup successful! Verification code sent.' }) };

  } catch (err) {
    console.error(err);
    await randomDelay();
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Failed to signup.', details: err.message }) };
  }
};
