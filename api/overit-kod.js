const { checkRateLimit, getClientIp } = require('./_rateLimit');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://zacniusebe.me';

// Prefix přístupového kódu pro tento produkt
const KOD_PREFIX = 'ZUS-LEAD-';

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting: 10 pokusů za 10 minut per IP
  const ip = getClientIp(req);
  const rl = checkRateLimit(`overit-kod-sv:${ip}`, 10, 10 * 60 * 1000);
  if (!rl.allowed) {
    return res.status(429).json({ valid: false, error: 'Příliš mnoho pokusů. Zkuste to za chvíli.' });
  }

  try {
    const { klic } = req.body;
    if (!klic || typeof klic !== 'string') {
      return res.status(400).json({ valid: false, error: 'Kód je povinný' });
    }
    const trimmed = klic.trim();

    if (!trimmed.toUpperCase().startsWith(KOD_PREFIX)) {
      return res.status(200).json({ valid: false, error: 'Neplatný kód' });
    }

    const notionRes = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ filter: { property: 'Kód', title: { equals: trimmed } } })
    });
    if (!notionRes.ok) {
      return res.status(502).json({ valid: false, error: 'Chyba ověření kódu' });
    }
    const data = await notionRes.json();

    if (!data.results || data.results.length === 0) {
      return res.status(200).json({ valid: false, error: 'Kód neexistuje' });
    }
    const page = data.results[0];
    const stav = page.properties['Stav']?.select?.name;
    if (stav === 'Použitý') {
      return res.status(200).json({ valid: false, error: 'Tento kód již byl použit' });
    }
    if (stav !== 'Aktivní') {
      return res.status(200).json({ valid: false, error: 'Kód není aktivní' });
    }

    // Otázky a texty výsledků jsou statické, žijí přímo ve frontendu —
    // není potřeba je posílat klientovi odsud.
    return res.status(200).json({ valid: true });

  } catch (error) {
    console.error('Notion verify error (styl vedeni)');
    return res.status(500).json({ valid: false, error: 'Chyba serveru' });
  }
};
