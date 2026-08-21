const router = require('express').Router();
const https = require('https');
const { protect } = require('../middleware/auth');
const { checkRateWindow } = require('../utils/rateLimiter');

// Rate limit cho API check-link (tối đa 30 requests/phút/user)
const NS_CHECK_LINK = 'check-link';

// ─── POST /api/security/check-link — Proxy kiểm tra Safe Browsing ──────────────
router.post('/check-link', protect, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ message: 'Thiếu URL cần kiểm tra' });
    }

    const userId = req.user._id.toString();
    const limit = await checkRateWindow(NS_CHECK_LINK, userId, { maxCount: 30, windowMs: 60000 });
    if (limit.limited) {
      return res.status(429).json({ safe: true, warning: 'Rate limit exceeded' });
    }

    const apiKey = process.env.SAFE_BROWSING_API_KEY;

    // Graceful degradation nếu chưa cấu hình API Key
    if (!apiKey) {
      return res.json({ safe: true, note: 'Safe Browsing API Key not configured' });
    }

    // Call Google Safe Browsing API v4
    const apiEndpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${apiKey}`;
    const payload = JSON.stringify({
      client: {
        clientId: 'chat-app-security',
        clientVersion: '1.0.0'
      },
      threatInfo: {
        threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
        platformTypes: ['ANY_PLATFORM'],
        threatEntryTypes: ['URL'],
        threatEntries: [{ url }]
      }
    });

    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 3000 // 3 giây timeout
    };

    const apiReq = https.request(apiEndpoint, requestOptions, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          const isThreat = json.matches && json.matches.length > 0;
          res.json({
            safe: !isThreat,
            threatType: isThreat ? json.matches[0].threatType : null
          });
        } catch {
          res.json({ safe: true });
        }
      });
    });

    apiReq.on('error', (err) => {
      console.error('[Security Proxy] Safe Browsing API Request error:', err.message);
      res.json({ safe: true }); // Graceful fallback
    });

    apiReq.on('timeout', () => {
      apiReq.destroy();
      res.json({ safe: true }); // Graceful fallback
    });

    apiReq.write(payload);
    apiReq.end();
  } catch (err) {
    console.error('Check link error:', err);
    res.json({ safe: true }); // Fallback an toàn, không crash app
  }
});

module.exports = router;
