const DEFAULT_SOURCE = 'Quick Pro Painters Website';
const DEFAULT_STATUS = 'new';
const TEST_RECIPIENT = 'abu@meerakapp.com';
const TEST_SUBJECT = 'TEST — New Quick Pro Estimate Request';

function sendJson(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clean(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function insertLead({ supabaseUrl, serviceRoleKey, lead }) {
  const response = await fetch(`${supabaseUrl}/rest/v1/leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([lead])
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`supabase_insert_failed:${response.status}:${text}`);
  }

  let json = [];
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`supabase_insert_parse_failed:${text}`);
  }

  if (!Array.isArray(json) || !json.length) {
    throw new Error('supabase_insert_empty_response');
  }

  return json[0];
}

async function sendOwnerEmail({ gmailToken, lead, createdAt }) {
  const submissionTime = new Date(createdAt || Date.now()).toUTCString();
  const body = [
    `Name: ${lead.name}`,
    `Phone: ${lead.phone}`,
    `Email: ${lead.email || ''}`,
    `Service: ${lead.service}`,
    `Submission date/time: ${submissionTime}`,
    `Source: ${lead.source}`
  ].join('\n');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${gmailToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      raw: Buffer.from(
        [
          `To: ${TEST_RECIPIENT}`,
          `Subject: ${TEST_SUBJECT}`,
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          body
        ].join('\r\n')
      ).toString('base64url')
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`gmail_send_failed:${response.status}:${text}`);
  }

  return text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const gmailToken = process.env.GMAIL_ACCESS_TOKEN || '';

  if (!supabaseUrl || !serviceRoleKey || !gmailToken) {
    return sendJson(res, 500, {
      error: 'Backend not configured',
      required_env: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GMAIL_ACCESS_TOKEN']
    });
  }

  const payload = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const name = clean(payload.name);
  const phone = clean(payload.phone);
  const email = clean(payload.email);
  const service = clean(payload.service);
  const source = clean(payload.source) || DEFAULT_SOURCE;

  if (!name || !phone || !service) {
    return sendJson(res, 400, { error: 'Name, phone, and service are required.' });
  }

  if (email && !isValidEmail(email)) {
    return sendJson(res, 400, { error: 'Please enter a valid email address.' });
  }

  const lead = {
    name,
    phone,
    email,
    service,
    source,
    status: DEFAULT_STATUS
  };

  try {
    const inserted = await insertLead({ supabaseUrl, serviceRoleKey, lead });
    await sendOwnerEmail({ gmailToken, lead, createdAt: inserted.created_at || Date.now() });
    return sendJson(res, 200, {
      ok: true,
      message: 'Thank you! We received your request. Quick Pro Painters will contact you soon.'
    });
  } catch (error) {
    console.error('estimate_endpoint_error', escapeHtml(error.message || String(error)));
    return sendJson(res, 500, { error: 'Submission failed.' });
  }
}
