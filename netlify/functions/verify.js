import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

// Create Supabase client using Netlify environment variables
const supabase = createClient(
  process.env.SUPABASE_URL,   // your Supabase project URL
  process.env.SUPABASE_KEY    // your Supabase service key
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ success: false, error: "Method not allowed" })
      };
    }

    const { email, code } = JSON.parse(event.body || '{}');

    if (!email || !code) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "Email and code required" })
      };
    }

    // Find the user safely
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) {
      return { statusCode: 500, body: JSON.stringify({ success: false, error: error.message }) };
    }

    if (!user) {
      return { statusCode: 404, body: JSON.stringify({ success: false, error: "User not found" }) };
    }

    if (user.verified) {
      return { statusCode: 200, body: JSON.stringify({ success: true, message: "Already verified" }) };
    }

    if (user.verification_code !== code.trim()) {
      return { statusCode: 400, body: JSON.stringify({ success: false, error: "Invalid verification code" }) };
    }

    // Nodemailer transporter using Netlify EMAIL_USER & EMAIL_PASS
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER, // your Gmail email set as Netlify secret
        pass: process.env.EMAIL_PASS  // Gmail app password set as Netlify secret
      }
    });

    // Send verification success email
    await transporter.sendMail({
      from: `"Botnev Team" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Your Botnev Account Verified ✅",
      text: `Hello ${user.username},\n\nYour email has been successfully verified. Welcome to Botnev!`
    });

    // Update user to mark as verified
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ verified: true, verification_code: null })
      .eq('email', email)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Email verified successfully and confirmation sent!",
        user: updatedUser
      })
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to verify email",
        details: err.message
      })
    };
  }
};
