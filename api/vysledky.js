const nodemailer = require('nodemailer');
const { checkRateLimit, getClientIp } = require('./_rateLimit');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://zacniusebe.me';

// Prefix přístupového kódu pro tento produkt
const KOD_PREFIX = 'ZUS-LEAD-';

const DOMENY_NAZVY = { R: 'Realizační talenty', O: 'Ovlivňovací talenty', V: 'Vztahové talenty', S: 'Strategické talenty' };
const PLATNE_DOMENY = ['R', 'O', 'V', 'S'];

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function cleanText(value = '', max = 120) {
  return String(value).replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
}

async function notionPatch(pageId, properties) {
  return fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({ properties })
  });
}

function vyhodnotDomeny(odpovedi) {
  const counts = { R: 0, O: 0, V: 0, S: 0 };
  odpovedi.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
  const max = Math.max.apply(null, Object.values(counts));
  const top = PLATNE_DOMENY.filter(k => counts[k] === max);
  return { counts, top };
}

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Rate limiting: 3 pokusy za 10 minut per IP
  const ip = getClientIp(req);
  const rlIp = checkRateLimit(`vysledky-sv:${ip}`, 3, 10 * 60 * 1000);
  if (!rlIp.allowed) {
    return res.status(429).json({ error: 'Příliš mnoho pokusů. Zkuste to za chvíli.' });
  }

  let pageId = null;
  let codeLocked = false;
  let completed = false;
  let emailSendingStarted = false;

  async function resetCodeToActive() {
    // Nikdy neresetovat pokud už začalo odesílání emailu — hrozí duplicity
    if (!pageId || !codeLocked || completed || emailSendingStarted) return;
    await notionPatch(pageId, { 'Stav': { select: { name: 'Aktivní' } } });
  }

  try {
    const { klic, jmeno, odpovedi } = req.body;

    // === ZÁKLADNÍ VALIDACE ===
    if (!klic || typeof klic !== 'string') {
      return res.status(400).json({ error: 'Chybí přístupový kód' });
    }
    if (!klic.trim().toUpperCase().startsWith(KOD_PREFIX)) {
      return res.status(403).json({ error: 'Neplatný přístupový kód' });
    }
    if (!jmeno || typeof jmeno !== 'string' || !jmeno.trim()) {
      return res.status(400).json({ error: 'Chybí jméno' });
    }
    if (!Array.isArray(odpovedi) || odpovedi.length !== 10 || !odpovedi.every(d => PLATNE_DOMENY.includes(d))) {
      return res.status(400).json({ error: 'Neplatné odpovědi' });
    }

    const cleanKlic = cleanText(klic, 80);
    const cleanJmeno = cleanText(jmeno, 120);
    const now = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' });
    const today = new Date().toISOString().split('T')[0];

    // Rate limit podle kódu — doplňuje IP limit, pokrývá sdílené IP a měnící se útočníky
    const rlCode = checkRateLimit(`vysledky-sv:klic:${cleanKlic}`, 3, 10 * 60 * 1000);
    if (!rlCode.allowed) {
      return res.status(429).json({ error: 'Příliš mnoho pokusů pro tento kód. Zkuste to za chvíli.' });
    }

    // === OVĚŘIT KÓD V NOTIONU ===
    const notionRes = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ filter: { property: 'Kód', title: { equals: cleanKlic } } })
    });
    if (!notionRes.ok) {
      return res.status(502).json({ error: 'Chyba ověření kódu' });
    }
    const notionData = await notionRes.json();

    if (!notionData.results || notionData.results.length === 0) {
      return res.status(403).json({ error: 'Neplatný přístupový kód' });
    }
    const page = notionData.results[0];
    const stav = page.properties['Stav']?.select?.name;
    if (stav === 'Použitý') return res.status(403).json({ error: 'Kód již byl použit' });
    if (stav === 'Zpracovává se') return res.status(403).json({ error: 'Kód se právě zpracovává' });
    if (stav !== 'Aktivní') return res.status(403).json({ error: 'Kód není aktivní' });

    pageId = page.id;

    // === ZAMKNOUT KÓD ===
    const lockRes = await notionPatch(pageId, { 'Stav': { select: { name: 'Zpracovává se' } } });
    if (!lockRes.ok) {
      return res.status(502).json({ error: 'Nepodařilo se zamknout kód' });
    }
    codeLocked = true;

    // === VYHODNOTIT DOMÉNY ZE SERVEROVÝCH DAT ===
    const { counts, top } = vyhodnotDomeny(odpovedi);
    const topNazvy = top.map(k => DOMENY_NAZVY[k]).join(' + ');

    const radky = PLATNE_DOMENY
      .slice()
      .sort((a, b) => counts[b] - counts[a])
      .map(k => `${DOMENY_NAZVY[k]}: ${counts[k]}/10${top.indexOf(k) !== -1 ? ' ★' : ''}`)
      .join('<br>');

    const htmlBody = `
      <div style="font-family:'Poppins','Segoe UI',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1C1C1C;">
        <div style="background:linear-gradient(135deg,#2E1555,#482683);padding:24px;border-radius:16px;color:#ffffff;margin-bottom:20px;">
          <p style="font-size:10px;letter-spacing:2px;color:#C19552;text-transform:uppercase;margin:0 0 6px;">Nový výsledek · Styl vedení</p>
          <h1 style="font-size:20px;margin:0;color:#ffffff;">${escapeHtml(cleanJmeno)}</h1>
          <p style="font-size:13px;color:#ffffff;opacity:0.7;margin:6px 0 0;">${escapeHtml(now)}</p>
        </div>
        <p style="font-size:14px;color:#1C1C1C;margin:0 0 10px;"><strong>Nejsilnější:</strong> ${escapeHtml(topNazvy)}</p>
        <p style="font-size:13px;color:#4A4258;line-height:1.8;margin:0 0 16px;">${radky}</p>
        <p style="font-size:12px;color:#7A6D8A;margin:0;">Kód: ${escapeHtml(cleanKlic)}</p>
      </div>`;

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });

    // === ODESLAT EMAIL MICHALOVI — od tohoto bodu se kód neresetuje ===
    emailSendingStarted = true;
    await transporter.sendMail({
      from: `"Začni u sebe" <${process.env.SMTP_USER}>`,
      to: process.env.SMTP_USER,
      subject: `${cleanJmeno} · Styl vedení · ${topNazvy}`,
      html: htmlBody,
    });

    // === OZNAČIT KÓD JAKO POUŽITÝ ===
    // Pozn.: pole "Vybrané hodnoty" sdílíme se stejnou Notion databází jako
    // aplikace na hodnoty — u tohoto produktu v něm místo hodnot uchováváme
    // JSON s odpověďmi a vyhodnocenými doménami.
    const updateRes = await notionPatch(pageId, {
      'Stav': { select: { name: 'Použitý' } },
      'Jméno klienta': { rich_text: [{ text: { content: cleanJmeno } }] },
      'Datum použití': { date: { start: today } },
      'Vybrané hodnoty': { rich_text: [{ text: { content: JSON.stringify({ odpovedi, vyhodnoceni: top }) } }] }
    });
    if (!updateRes.ok) {
      console.error('Notion final update failed (styl vedeni) — code remains in Zpracovává se');
    }

    completed = true;
    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Server error in vysledky (styl vedeni)');
    await resetCodeToActive().catch(() => console.error('Reset failed in catch'));
    return res.status(500).json({ error: 'Chyba serveru' });
  }
};
