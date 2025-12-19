import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Helper: split large string into chunks of maxChunkSize bytes
function chunkString(str, maxChunkSize = 50000) {
  const chunks = [];
  let start = 0;
  while (start < str.length) {
    chunks.push(str.slice(start, start + maxChunkSize));
    start += maxChunkSize;
  }
  return chunks;
}

// Helper: trigger Netlify deploy via build hook
async function triggerNetlifyDeploy(siteName) {
  const NETLIFY_DEPLOY_HOOK = process.env.NETLIFY_DEPLOY_HOOK; // add this to your environment
  if (!NETLIFY_DEPLOY_HOOK) return;

  try {
    const response = await fetch(NETLIFY_DEPLOY_HOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_name: siteName
      })
    });

    if (!response.ok) {
      console.error('Netlify deploy hook failed:', response.statusText);
    }
  } catch (err) {
    console.error('Error triggering Netlify deploy:', err);
  }
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body', details: parseError.message })
      };
    }

    const { site_name, files } = body;

    if (!site_name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing site_name' }) };
    }

    if (!/^[a-z0-9-]{3,30}$/.test(site_name)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid site name. Only lowercase letters, numbers, and - allowed.' }) };
    }

    if (!files || typeof files !== 'object') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid files object' }) };
    }

    // Check if subdomain already exists
    const { data: existing, error: selectError } = await supabase
      .from('sites')
      .select('subdomain')
      .eq('subdomain', site_name)
      .maybeSingle();

    if (selectError) {
      console.error('Supabase select error:', selectError);
      return { statusCode: 500, body: JSON.stringify({ error: 'Supabase select error', details: selectError }) };
    }

    if (existing) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Subdomain already exists' }) };
    }

    // Chunk files
    const chunkedFiles = {};
    for (const [filename, content] of Object.entries(files)) {
      chunkedFiles[filename] = chunkString(content, 50000);
    }

    // Set expiration one month from now
    const expires_at = new Date();
    expires_at.setMonth(expires_at.getMonth() + 1);

    // Insert into Supabase
    const { data: insertedData, error: insertError, status } = await supabase
      .from('sites')
      .insert({
        name: site_name,
        subdomain: site_name,
        files: chunkedFiles,
        expires_at,
        created_at: new Date()
      });

    if (insertError) {
      console.error('Supabase insert error full object:', insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: 'Supabase insert error',
          status,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
          code: insertError.code
        })
      };
    }

    // ✅ Trigger Netlify deploy hook
    await triggerNetlifyDeploy(site_name);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Site created successfully and deploy triggered',
        url: `https://${site_name}.fire-usa.com`,
        insertedData
      })
    };

  } catch (err) {
    console.error('Unhandled create-site error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Unhandled error', details: err.message }) };
  }
};
