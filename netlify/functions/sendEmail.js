import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   CONFIG
========================= */
const MAX_EMAILS_PER_5_HOURS = 15;  // Max emails in a rolling 5-hour window
const MAX_EMAILS_PER_DAY = 30;      // Max emails per 24 hours
const MAX_LINKS = 3;

/* =========================
   EMAIL TRANSPORT
========================= */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  secure: true
});

/* =========================
   HELPERS
========================= */
const sanitize = (str = '') =>
  str
    .replace(/[&<>"'/]/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;'
    }[c]))
    .replace(/(\r|\n)/g, '');

const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const getClientIP = (event) =>
  event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  event.headers['client-ip'] ||
  'unknown';

const spamScore = (text) => {
  let score = 0;
  const links = (text.match(/https?:\/\//gi) || []).length;
  if (links > MAX_LINKS) score += 3;
  if (text.length < 5) score += 2;
  if (/(free money|click here|buy now|crypto|airdrop)/i.test(text)) score += 4;
  if (/(.)\1{10,}/.test(text)) score += 2;
  return score;
};

/* =========================
   HANDLER
========================= */
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    /* ---------- Auth ---------- */
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'];
    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    const { data: sessionData } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .single();

    if (!sessionData || new Date(sessionData.expires_at) < new Date()) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    const from_user = sessionData.user_email;
    const ip = getClientIP(event);

    /* ---------- Sender ---------- */
    const { data: senderData } = await supabase
      .from('users')
      .select('email, username, avatar_url, last_online, verified')
      .eq('email', from_user)
      .single();

    if (!senderData || !senderData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified' }) };
    }

    /* ---------- Body ---------- */
    let payload;
    try { payload = JSON.parse(event.body || '{}'); } 
    catch { return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid JSON' }) }; }

    let { to_user, subject, body } = payload;

    if (!to_user || !body || body.length > 2000 || (subject && subject.length > 200)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid input' }) };
    }

    if (!isValidEmail(to_user)) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Invalid recipient email' }) };
    }

    subject = sanitize(subject || 'New message');
    body = sanitize(body);

    /* ---------- Recipient ---------- */
    const { data: recipientData } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', to_user)
      .single();

    if (!recipientData || !recipientData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Recipient invalid' }) };
    }

    /* ---------- Block check ---------- */
    const { data: block } = await supabase
      .from('blocked_users')
      .select('id')
      .eq('blocker', to_user)
      .eq('blocked', from_user)
      .maybeSingle();

    if (block) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Recipient has blocked you' }) };
    }

    /* ---------- Rate limiting ---------- */
    const now = new Date();
    const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const { count: fiveHourCount } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('from_user', from_user)
      .gte('created_at', fiveHoursAgo)
      .not('spam_score', 'gte', 5); // ignore spam

    if (fiveHourCount >= MAX_EMAILS_PER_5_HOURS) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: '5-hour limit reached. Try later.' }) };
    }

    const { count: dayCount } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('from_user', from_user)
      .gte('created_at', oneDayAgo)
      .not('spam_score', 'gte', 5);

    if (dayCount >= MAX_EMAILS_PER_DAY) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Daily limit reached. Try tomorrow.' }) };
    }

    /* ---------- Spam scoring ---------- */
    const score = spamScore(`${subject} ${body}`);
    if (score >= 5) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Message flagged as spam' }) };
    }

    /* ---------- Store ---------- */
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject,
      body,
      ip_address: ip,
      spam_score: score,
      created_at: new Date().toISOString()
    });

    /* ---------- Send (NO SPOOFING) ---------- */
    await transporter.sendMail({
      from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
      to: recipientData.email,
      replyTo: senderData.email,
      subject,
      text: `${senderData.username} says:\n\n${body}`
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false }) };
  }
};
