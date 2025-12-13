import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const { email, password, remember_me } = JSON.parse(event.body);

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !user) return { statusCode: 400, body: JSON.stringify({ success:false, error:'User not found' }) };

    const match = await bcrypt.compare(password, user.password);
    if (!match) return { statusCode: 401, body: JSON.stringify({ success:false, error:'Incorrect password' }) };

    if (!user.verified) return { statusCode: 403, body: JSON.stringify({ success:false, error:'Email not verified' }) };

    let session_token = null;
    if (remember_me) {
      session_token = uuidv4();
      const expires_at = new Date();
      expires_at.setMonth(expires_at.getMonth() + 3); // 3 months persistent

      await supabase.from('sessions').insert({
        user_email: email,
        session_token,
        expires_at
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Login successful!',
        session_token
      })
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success:false, error:'Login failed' }) };
  }
};
