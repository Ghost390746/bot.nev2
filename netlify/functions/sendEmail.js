import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_PASS
        }
      })
    : null;

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ success: false }) };
    }

    const { session_token, to_user, subject, body } =
      JSON.parse(event.body || '{}');

    if (!session_token || !to_user || !body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Missing fields' })
      };
    }

    if (body.length > 5000) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'Message too long' })
      };
    }

    // 🔐 Verify session
    const { data: session } = await supabase
      .from('sessions')
      .select('user_email')
      .eq('session_token', session_token)
      .single();

    if (!session) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Invalid session' })
      };
    }

    const from_user = session.user_email;

    // ✅ Verify sender
    const { data: sender } = await supabase
      .from('users')
      .select('email, verified')
      .eq('email', from_user)
      .eq('verified', true)
      .single();

    if (!sender) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Sender not verified' })
      };
    }

    // ✅ Verify recipient
    const { data: recipient } = await supabase
      .from('users')
      .select('email, verified')
      .eq('email', to_user)
      .eq('verified', true)
      .single();

    if (!recipient) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, error: 'Recipient not found' })
      };
    }

    // 📨 Store internal message
    await supabase.from('emails').insert({
      id: uuidv4(),
      from_user,
      to_user,
      subject: subject || '',
      body
    });

    // ✉️ Send real email
    if (transporter) {
      await transporter.sendMail({
        from: `"Botnev Mail" <${process.env.EMAIL_USER}>`,
        to: to_user,
        replyTo: from_user,
        subject: subject || `New message from ${from_user}`,
        text: body
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Message sent successfully'
      })
    };
  } catch (err) {
    console.error('sendEmail error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Server error' })
    };
  }
};
