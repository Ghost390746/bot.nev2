import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   CONFIG
========================= */
const MAX_EMAILS_PER_5_HOURS = 50;
const MAX_EMAILS_PER_DAY = 200;
const MAX_LINKS = 3;
const NEW_SYSTEM_START = new Date('2025-12-27T00:00:00Z').toISOString();

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
  str.replace(/[&<>"'/]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  }[c]));

const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const getClientIP = (event) =>
  event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  event.headers['client-ip'] ||
  'unknown';

const spamScore = (text) => {
  let score = 0;
  const links = (text.match(/https?:\/\//gi) || []).length;
  if (links > MAX_LINKS) score += 3;
  if (text.length < 5) score += 2;
  if (/(free money|click here|buy now|crypto|airdrop|giveaway)/i.test(text)) score += 4;
  if (/(.)\1{10,}/.test(text)) score += 2;
  return score;
};

const getRateLimits = async (from_user, ip, since) => {
  const { count: userCount } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .eq('from_user', from_user)
    .gte('created_at', since);

  const { count: ipCount } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .gte('created_at', since);

  return { userCount, ipCount };
};

/* =========================
   HANDLER
========================= */
export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false, error: 'Method not allowed' }) };
    }

    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies['__Host-session_secure'];
    if (!session_token) return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };

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

    const { data: senderData } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', from_user)
      .single();

    if (!senderData || !senderData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Sender not verified' }) };
    }

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

    const { data: recipientData } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', to_user)
      .single();

    if (!recipientData || !recipientData.verified) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Recipient invalid' }) };
    }

    const { data: block } = await supabase
      .from('blocked_users')
      .select('id')
      .eq('blocker', to_user)
      .eq('blocked', from_user)
      .maybeSingle();

    if (block) return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Recipient has blocked you' }) };

    const score = spamScore(`${subject} ${body}`);
    if (score >= 5) return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Message flagged as spam' }) };

    const now = new Date();
    const fiveHoursAgo = new Date(Math.max(now.getTime() - 5 * 60 * 60 * 1000, new Date(NEW_SYSTEM_START).getTime())).toISOString();
    const oneDayAgo = new Date(Math.max(now.getTime() - 24 * 60 * 60 * 1000, new Date(NEW_SYSTEM_START).getTime())).toISOString();

    const { userCount: last5hUser, ipCount: last5hIP } = await getRateLimits(from_user, ip, fiveHoursAgo);
    const { userCount: lastDayUser } = await getRateLimits(from_user, ip, oneDayAgo);

    if (last5hUser >= MAX_EMAILS_PER_5_HOURS || last5hIP >= MAX_EMAILS_PER_5_HOURS) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: '5-hour limit reached. Try later.' }) };
    }

    if (lastDayUser >= MAX_EMAILS_PER_DAY) {
      return { statusCode: 429, body: JSON.stringify({ success: false, error: 'Daily limit reached. Try tomorrow.' }) };
    }

    // Prevent repeated messages
    const { count: repeated } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('from_user', from_user)
      .eq('body', body)
      .gte('created_at', fiveHoursAgo);

    if (repeated > 0) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Repeated message detected' }) };
    }

    // Send email
    await transporter.sendMail({
      from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
      to: recipientData.email,
      replyTo: senderData.email,
      subject,
      text: `${senderData.username} says:\n\n${body}`,
      html: `<p><strong>${senderData.username} says:</strong></p><p>${body}</p>`
    });

    // Store email record
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject,
      body,
      ip_address: ip,
      spam_score: score,
      created_at: now.toISOString()
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };

  } catch (err) {
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false }) };
  }
};
