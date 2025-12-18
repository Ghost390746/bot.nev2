import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import cookie from 'cookie';

// Initialize Supabase with service role key for secure updates
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ success: false, error: "Method not allowed" })
      };
    }

    // ✅ Parse cookies safely
    const cookies = cookie.parse(event.headers.cookie || '');

    // ✅ Support BOTH new and legacy auth cookies
    const session_token =
      cookies['__Host-session_secure'] || // new secure login
      cookies['session_token'];            // legacy / recovery login

    if (!session_token) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: "No session cookie found" })
      };
    }

    // ✅ Verify session (token treated as opaque)
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('user_email, expires_at')
      .eq('session_token', session_token)
      .maybeSingle();

    if (sessionError || !session) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: "Invalid session" })
      };
    }

    if (new Date(session.expires_at) < new Date()) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: "Session expired" })
      };
    }

    const { email, updates } = JSON.parse(event.body || '{}');

    if (!email || email !== session.user_email) {
      return {
        statusCode: 403,
        body: JSON.stringify({ success: false, error: "Email mismatch or missing" })
      };
    }

    // Fetch the user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (userError) throw userError;
    if (!user) {
      return {
        statusCode: 404,
        body: JSON.stringify({ success: false, error: "User not found" })
      };
    }

    const updateData = {};

    // Allow updating only specific fields
    const allowedFields = [
      'username',
      'display_name',
      'bio',
      'profile_picture',
      'password'
    ];

    for (const field of allowedFields) {
      if (updates?.[field]) {
        updateData[field] = updates[field];
      }
    }

    // Handle password separately
    if (updateData.password) {
      const isSamePassword = await bcrypt.compare(
        updateData.password,
        user.password
      );

      if (!isSamePassword) {
        updateData.password = await bcrypt.hash(updateData.password, 12);
      } else {
        delete updateData.password;
      }
    }

    // Update user securely
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update(updateData)
      .eq('email', email)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;

    // Return safe user object
    const safeUser = { ...updatedUser };
    delete safeUser.password;

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: "Profile updated successfully!",
        user: safeUser
      })
    };

  } catch (err) {
    console.error('Profile update error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: "Failed to update profile"
      })
    };
  }
};
