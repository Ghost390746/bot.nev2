import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

// Use Netlify environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Missing required environment variables!");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const handler = async (event) => {
  try {
    // Parse request body
    const { email, password, remember_me } = JSON.parse(event.body);

    // Fetch user from Supabase
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: 'User not found' })
      };
    }

    // Compare password
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return {
        statusCode: 401,
        body: JSON.stringify({ success: false, error: 'Incorrect password' })
      };
    }

    // Check if email is verified
    if (!user.verified) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: 'Email not verified' })
      };
    }

    // Generate a simple session token
    const session_token = uuidv4();

    // Optional persistent session in Supabase
    if (remember_me) {
      const expires_at = new Date();
      expires_at.setMonth(expires_at.getMonth() + 3); // 3 months

      await supabase.from('sessions').insert({
        user_email: email,
        session_token,
        expires_at
      });
    }

    // Return success with session token (store in localforage on frontend)
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Login successful!',
        session_token
      })
    };

  } catch (err) {
    console.error("Login error:", err); // full backend error logging
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || 'Login failed' })
    };
  }
};
