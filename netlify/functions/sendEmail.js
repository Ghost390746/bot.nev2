// netlify/functions/sendEmail.js
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import nodemailer from 'nodemailer';
import cookie from 'cookie';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Email transporter (real email sending)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

export const handler = async (event) => {
  try {
    // 🍪 Read session token from cookie (your actual cookie name)
    const cookies = cookie.parse(event.headers.cookie || '');
    const session_token = cookies.ion_token; // <-- update if your cookie name differs

    if (!session_token) {
      return { statusCode: 401, body: JSON.stringify({ success: false, error: 'Not authenticated' }) };
    }

    // 🔐 Verify session
    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (sessionError || !sessionData) {
      return { statusCode: 403, body: JSON.stringify({ success: false, error: 'Invalid session' }) };
    }

    const from_user = sessionData.user_email;

    // Parse email details
    const { to_user, subject, body } = JSON.parse(event.body || '{}');
    if (!to_user || !body) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: 'Missing required fields' }) };
    }

    // Insert email into DB
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject: subject || '',
      body
    });

    // Send real email
    await transporter.sendMail({
      from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
      to: to_user,
      replyTo: from_user,
      subject: subject || 'New message',
      text: body
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Email sent successfully' }) };

  } catch (err) {
    console.error('sendEmail error:', err);
    return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Internal server error', details: err.message }) };
  }
};
