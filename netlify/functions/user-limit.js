import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ----------- CONFIG -----------
const LIMIT = 100;
const TEST_EMAIL = "babyyodacutefry@gmail.com";
// ------------------------------

export const handler = async (event) => {
  try {
    // Grab session cookie
    const cookieHeader = event.headers.cookie || "";
    const session = cookieHeader
      .split("; ")
      .find(c => c.startsWith("session_token="))
      ?.split("=")[1];

    let emailFromSession = null;

    // If a session exists, look up email
    if (session) {
      const { data } = await supabase
        .from("sessions")
        .select("user_email")
        .eq("session_token", session)
        .maybeSingle();

      if (data?.user_email) {
        emailFromSession = data.user_email;
      }
    }

    // Count users
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    // Allowed if:
    // - Under limit
    // - OR over limit but logged in as test email
    const allowed =
      count < LIMIT ||
      emailFromSession === TEST_EMAIL;

    return {
      statusCode: 200,
      body: JSON.stringify({
        allowed,
        count,
        isTest: emailFromSession === TEST_EMAIL
      })
    };

  } catch (err) {
    console.error("USER LIMIT ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        allowed: false,
        error: err.message
      })
    };
  }
};
