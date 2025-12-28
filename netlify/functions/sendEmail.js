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
const MAX_EMAILS_PER_30_MINUTES = 30;
const EMAIL_RETENTION_MS = 60 * 60 * 1000; // 1 hour
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

const getSessionUser = async (event) => {
  const cookies = cookie.parse(event.headers.cookie || '');
  const session_token = cookies['__Host-session_secure'];
  if (!session_token) return null;

  const { data: sessionData } = await supabase
    .from('sessions')
    .select('user_email, expires_at')
    .eq('session_token', session_token)
    .single();

  if (!sessionData || new Date(sessionData.expires_at) < new Date()) return null;
  return sessionData.user_email;
};

/* =========================
   UTILITY FOR RESPONSE
========================= */
const jsonResponse = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

/* =========================
   EMAIL HANDLER
========================= */
const sendEmail = async (event) => {
  try {
    const from_user = await getSessionUser(event);
    if (!from_user)
      return jsonResponse({ success: false, error: 'Not authenticated' }, 401);

    const { data: senderData } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', from_user)
      .single();

    if (!senderData || !senderData.verified)
      return jsonResponse({ success: false, error: 'Sender not verified' }, 403);

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

    let { to_user, subject, body } = payload;
    if (!to_user || !body || body.length > 2000 || (subject && subject.length > 200))
      return jsonResponse({ success: false, error: 'Invalid input' }, 400);

    if (!isValidEmail(to_user))
      return jsonResponse({ success: false, error: 'Invalid recipient email' }, 400);

    subject = sanitize(subject || 'New message');
    body = sanitize(body);

    const { data: recipientData } = await supabase
      .from('users')
      .select('email, username, verified')
      .eq('email', to_user)
      .single();

    if (!recipientData || !recipientData.verified)
      return jsonResponse({ success: false, error: 'Recipient invalid' }, 403);

    const { data: block } = await supabase
      .from('blocked_users')
      .select('id')
      .eq('blocker', to_user)
      .eq('blocked', from_user)
      .maybeSingle();

    if (block)
      return jsonResponse({ success: false, error: 'Recipient has blocked you' }, 403);

    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    const retentionThreshold = new Date(now.getTime() - EMAIL_RETENTION_MS).toISOString();

    // Delete old emails
    await supabase.from('emails').delete().lt('created_at', retentionThreshold);

    // 30-min email limit
    const { count: sentCount } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('from_user', from_user)
      .gte('created_at', thirtyMinutesAgo);

    if (sentCount >= MAX_EMAILS_PER_30_MINUTES)
      return jsonResponse({ success: false, error: '30-minute limit reached. Try later.' }, 429);

    // Repeated message
    const { count: repeated } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('from_user', from_user)
      .eq('body', body)
      .gte('created_at', thirtyMinutesAgo);

    if (repeated > 0)
      return jsonResponse({ success: false, error: 'Repeated message detected' }, 400);

    // Send email
    await transporter.sendMail({
      from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
      to: recipientData.email,
      replyTo: senderData.email,
      subject,
      text: `${senderData.username} says:\n\n${body}`,
      html: `<p><strong>${senderData.username} says:</strong></p><p>${body}</p>`
    });

    // Store email
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject,
      body,
      ip_address: getClientIP(event),
      spam_score: spamScore(`${subject} ${body}`),
      created_at: now.toISOString()
    });

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('sendEmail error:', err);
    return jsonResponse({ success: false }, 500);
  }
};

/* =========================
   BLOCK HANDLERS
========================= */
const blockUser = async (event) => {
  try {
    const from_user = await getSessionUser(event);
    if (!from_user) return jsonResponse({ success: false, error: 'Not authenticated' }, 401);

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

    const { target_email } = payload;
    if (!target_email || !isValidEmail(target_email))
      return jsonResponse({ success: false, error: 'Invalid email' }, 400);

    await supabase.from('blocked_users').upsert({ blocker: from_user, blocked: target_email });
    return jsonResponse({ success: true, message: `Blocked ${target_email}` });
  } catch (err) {
    console.error('blockUser error:', err);
    return jsonResponse({ success: false }, 500);
  }
};

const unblockUser = async (event) => {
  try {
    const from_user = await getSessionUser(event);
    if (!from_user) return jsonResponse({ success: false, error: 'Not authenticated' }, 401);

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

    const { target_email } = payload;
    if (!target_email || !isValidEmail(target_email))
      return jsonResponse({ success: false, error: 'Invalid email' }, 400);

    await supabase.from('blocked_users').delete().eq('blocker', from_user).eq('blocked', target_email);
    return jsonResponse({ success: true, message: `Unblocked ${target_email}` });
  } catch (err) {
    console.error('unblockUser error:', err);
    return jsonResponse({ success: false }, 500);
  }
};

const listBlockedUsers = async (event) => {
  try {
    const from_user = await getSessionUser(event);
    if (!from_user) return jsonResponse({ success: false, error: 'Not authenticated' }, 401);

    const { data } = await supabase
      .from('blocked_users')
      .select('blocked')
      .eq('blocker', from_user);

    return jsonResponse({ success: true, blocked: data.map(d => d.blocked) });
  } catch (err) {
    console.error('listBlockedUsers error:', err);
    return jsonResponse({ success: false }, 500);
  }
};

/* =========================
   NETLIFY DEFAULT EXPORT
========================= */
export default async function handler(event) {
  let payload = {};
  try { payload = JSON.parse(event.body || '{}'); } catch {}

  switch(payload.action) {
    case 'send':        return sendEmail(event);
    case 'block':       return blockUser(event);
    case 'unblock':     return unblockUser(event);
    case 'listBlocked': return listBlockedUsers(event);
    default:
      return jsonResponse({ success: false, error: 'Unknown action' }, 400);
  }
}
