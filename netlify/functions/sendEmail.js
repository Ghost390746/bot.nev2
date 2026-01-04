import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';
import crypto from 'crypto';

/* ======================
   ENV SAFETY CHECK
====================== */
['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','EMAIL_USER','EMAIL_PASS'].forEach(k=>{
  if(!process.env[k]) throw new Error(`Missing env: ${k}`);
});

/* ======================
   SECURITY CONSTANTS
====================== */
const USER_LIMIT = 50;                 
const USER_WINDOW = 30 * 60 * 1000;    
const CLEANUP_INTERVAL = 3 * 60 * 60 * 1000;
const MESSAGE_RETENTION = 3 * 60 * 60 * 1000;

const ipBucket = new Map();
const userBucket = new Map();
let lastCleanup = 0;

/* ======================
   SUPABASE
====================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/* ======================
   MAIL
====================== */
const transporter = nodemailer.createTransport({
  service:'gmail',
  auth:{ user:process.env.EMAIL_USER, pass:process.env.EMAIL_PASS },
  secure:true
});

/* ======================
   HELPERS
====================== */
const sanitize = str => (str||'').replace(/[&<>"']/g,m=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;'
}[m]));

const escapeHTML = str => sanitize(str).replace(/\n/g,'<br>');
const isValidEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const getIP = e =>
  e.headers['x-forwarded-for']?.split(',')[0] ||
  e.headers['client-ip'] ||
  'unknown';

const now = () => Date.now();

function bucketCheck(bucket, key, limit, window){
  const t = now();
  const rec = bucket.get(key) || { count:0, time:t };
  if(t - rec.time > window){ rec.count = 0; rec.time = t; }
  rec.count++;
  bucket.set(key, rec);
  return rec.count <= limit;
}

async function cleanupEmails(){
  if(now() - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now();
  const cutoff = new Date(now() - MESSAGE_RETENTION).toISOString();
  await supabase.from('emails').delete().lt('created_at', cutoff);
}

function secureCompare(a,b){
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if(x.length !== y.length) return false;
  return crypto.timingSafeEqual(x,y);
}

/* ======================
   HANDLER
====================== */
export const handler = async (event) => {
  try {
    await cleanupEmails();

    if(event.httpMethod !== 'POST')
      return res(405,'Method Not Allowed');

    const ip = getIP(event);

    if(!bucketCheck(ipBucket, ip, 200, USER_WINDOW))
      return res(429,'Rate limit exceeded');

    const cookies = cookie.parse(event.headers.cookie||'');
    const token = cookies['__Host-session_secure'];
    if(!token) return res(401,'Not authenticated');

    const { data:session } = await supabase
      .from('sessions')
      .select('user_email,expires_at,session_token')
      .eq('session_token',token)
      .single();

    if(!session || new Date(session.expires_at) < new Date())
      return res(403,'Session invalid');

    if(!secureCompare(token, session.session_token))
      return res(403,'Session integrity violation');

    const from_user = session.user_email;

    if(!bucketCheck(userBucket, from_user, USER_LIMIT, USER_WINDOW))
      return res(429,'User sending limit exceeded');

    const { data:sender } = await supabase
      .from('users')
      .select('email,username,avatar_url,last_online,verified')
      .eq('email',from_user)
      .single();

    if(!sender?.verified)
      return res(403,'Sender not verified');

    let payload;
    try { payload = JSON.parse(event.body||'{}'); }
    catch { return res(400,'Invalid JSON'); }

    let { to_user, subject, body } = payload;

    if(!to_user || !body || body.length>2000 || subject?.length>200)
      return res(400,'Invalid input');

    if(!isValidEmail(to_user))
      return res(400,'Invalid recipient');

    subject = sanitize(subject||'New message');
    body = sanitize(body);

    const { data:recipient } = await supabase
      .from('users')
      .select('email,username,verified')
      .eq('email',to_user)
      .single();

    if(!recipient?.verified)
      return res(403,'Recipient invalid');

    const msgHash = crypto.createHash('sha256')
      .update(from_user+to_user+body)
      .digest('hex');

    const { data:dup } = await supabase
      .from('emails')
      .select('id')
      .eq('hash', msgHash)
      .gte('created_at', new Date(now()-USER_WINDOW).toISOString())
      .maybeSingle();

    if(dup) return res(409,'Duplicate message detected');

    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject,
      body,
      hash: msgHash,
      ip_address: ip,
      created_at: new Date().toISOString()
    });

    const online = now() - new Date(sender.last_online||0) < 5*60*1000;
    const avatar = sender.avatar_url ||
      `https://avatars.dicebear.com/api/initials/${encodeURIComponent(sender.username)}.svg`;

    await transporter.sendMail({
      from: `"${sender.username}" <${sender.email}>`,
      to: recipient.email,
      replyTo: sender.email,
      subject,
      text: `${sender.username} says:\n\n${body}`,
      html: `
        <div style="font-family:sans-serif">
          <img src="${avatar}" width="48" style="border-radius:50%">
          <b>${sender.username}</b> (${online?'Online':'Offline'})
          <hr>
          ${escapeHTML(body)}
        </div>
      `
    });

    return res(200,{ success:true });

  } catch (err) {
    console.error('BANK-GRADE ERROR:',err);
    return res(500,'Server error');
  }
};

function res(code,data){
  return {
    statusCode: code,
    headers:{
      'Content-Type':'application/json',
      'X-Content-Type-Options':'nosniff',
      'X-Frame-Options':'DENY',
      'Referrer-Policy':'no-referrer'
    },
    body: JSON.stringify(typeof data==='string'?{error:data}:data)
  };
}
