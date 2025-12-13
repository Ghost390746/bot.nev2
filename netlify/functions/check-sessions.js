import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    const { session_token } = JSON.parse(event.body);
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', session_token)
      .single();

    if (!session || new Date(session.expires_at) < new Date()) {
      return { statusCode: 401, body: JSON.stringify({ success:false, error:'Invalid or expired session' }) };
    }

    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('email', session.user_email)
      .single();

    return { statusCode: 200, body: JSON.stringify({ success:true, user }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success:false, error:'Session check failed' }) };
  }
};
