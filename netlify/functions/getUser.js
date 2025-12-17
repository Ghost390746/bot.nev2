import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

export const handler = async (event) => {
  try {
    if(event.httpMethod !== "POST"){
      return { statusCode: 405, body: JSON.stringify({ success:false, error:"Method not allowed" }) };
    }

    const { email } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, body: JSON.stringify({ success:false, error:"Email required" }) };

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if(error) throw error;
    if(!user) return { statusCode: 404, body: JSON.stringify({ success:false, error:"User not found" }) };

    return { statusCode: 200, body: JSON.stringify({ success:true, user }) };

  } catch(err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ success:false, error:"Failed to fetch user", details: err.message }) };
  }
};
