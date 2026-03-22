// api/ai.js — Vercel Serverless Function
// Proxies requests to Claude API, keeping the API key server-side.
// Never exposes ANTHROPIC_API_KEY to the browser.

const rateLimitMap = new Map(); // userId -> { count, windowStart }
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 60; // 60 questions/hour per user

function setCORSHeaders(res, req) {
  const origin = req.headers.origin || '';
  const appDomain = process.env.APP_DOMAIN || '';
  const isDev = origin.includes('localhost') || origin.includes('127.0.0.1');
  const isAllowed =
    isDev ||
    (appDomain && origin.includes(appDomain)) ||
    origin.endsWith('.vercel.app');
  const allowOrigin = isAllowed ? origin : (appDomain ? `https://${appDomain}` : '');
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

module.exports = async function handler(req, res) {
  setCORSHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const token = authHeader.slice(7);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  // Verify token against Supabase
  let userId;
  try {
    const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey,
      },
    });
    if (!userResp.ok) return res.status(401).json({ error: 'Invalid session' });
    const userData = await userResp.json();
    userId = userData.id;
    if (!userId) throw new Error('No user id in token');
  } catch (err) {
    console.error('[ai] token verify error:', err.message);
    return res.status(401).json({ error: 'Session verification failed' });
  }

  // Server-side rate limiting (hourly window)
  const now = Date.now();
  const userRate = rateLimitMap.get(userId) || { count: 0, windowStart: now };
  if (now - userRate.windowStart > RATE_LIMIT_WINDOW_MS) {
    userRate.count = 0;
    userRate.windowStart = now;
  }
  if (userRate.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: `Rate limit exceeded. Max ${RATE_LIMIT_MAX} AI questions per hour.`,
    });
  }
  userRate.count++;
  rateLimitMap.set(userId, userRate);

  // Validate request body
  const { messages, system } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }
  if (messages.length > 24) {
    return res.status(400).json({ error: 'Too many messages (max 24)' });
  }

  // Sanitize messages
  const clean = messages.filter(
    m =>
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.length > 0 &&
      m.content.length <= 4000
  );

  if (clean.length === 0) {
    return res.status(400).json({ error: 'No valid messages after sanitization' });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  try {
    const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system:
          system ||
          'You are MedCore AI, an expert medical education tutor for Zambian medical students (UNZA, CBU, Levy). Explain concepts clearly, connect basic science to clinical relevance, and use mnemonics where helpful. Highlight high-yield points with 💡 and warn about common exam mistakes with ⚠️. Use **bold** for key terms. Be concise but thorough.',
        messages: clean,
      }),
    });

    if (!claudeResp.ok) {
      const errBody = await claudeResp.text();
      console.error('[ai] Claude API error:', claudeResp.status, errBody);
      if (claudeResp.status === 429) {
        return res.status(429).json({ error: 'AI service is busy. Please try again shortly.' });
      }
      return res.status(502).json({ error: 'AI service error' });
    }

    const data = await claudeResp.json();

    res.setHeader('X-RateLimit-Limit',     RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - userRate.count));
    res.setHeader('X-RateLimit-Reset',     Math.floor((userRate.windowStart + RATE_LIMIT_WINDOW_MS) / 1000));

    return res.status(200).json({
      content: data.content,
      usage:   data.usage,
    });

  } catch (err) {
    console.error('[ai] proxy error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
