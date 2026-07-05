# Styl vedení podle silných stránek

Interní diagnostický nástroj pro Michala – klient odpoví na 10 otázek, hned uvidí
svou nejsilnější doménu (nebo kombinaci) podle Gallup CliftonStrengths, a výsledek
zároveň přijde emailem Michalovi. Klient sám žádný email nedostává.

## Struktura repozitáře

```
/index.html          – celá frontendová aplikace (statická stránka)
/api/overit-kod.js   – ověří přístupový kód v Notionu
/api/vysledky.js     – uloží výsledek, zamkne kód, pošle email Michalovi
/api/_rateLimit.js   – sdílený in-memory rate limiter
```

## Než nasadíš — 1 věc k doplnění

**Odkaz na konzultaci** — v `index.html` je konstanta `KONZULTACE_URL`
(aktuálně `https://michalvalenta.cz`). Nastav na stránku/kalendář, kam má
tlačítko "Domluvit konzultaci" vést.

Prefix přístupového kódu (`ZUS-LEAD-`) je už nastavený v obou API souborech.

## Proměnné prostředí (Vercel → Settings → Environment Variables)

Stejné jako u aplikace Moje osobní hodnoty — používá se **stejná Notion
databáze** na přístupové kódy:

| Proměnná | Hodnota |
|---|---|
| `NOTION_TOKEN` | stejný token jako u hodnot |
| `NOTION_DB_ID` | `d9dd7fb375904f2f8a4f525d7f77d9e1` (databáze kódů) |
| `ALLOWED_ORIGIN` | `https://zacniusebe.me` |
| `SMTP_HOST` | stejné SMTP jako u hodnot (websupport.cz) |
| `SMTP_PORT` | stejné |
| `SMTP_USER` | stejné |
| `SMTP_PASS` | stejné |

## Jak přidat nové přístupové kódy

V Notion databázi kódů (stejná jako pro hodnoty) přidej novou stránku:
- **Kód** (title): např. `ZUS-LEAD-0001`
- **Stav** (select): `Aktivní`

Po vyplnění dotazníku aplikace sama nastaví Stav na `Použitý`, doplní
**Jméno klienta**, **Datum použití** a do pole **Vybrané hodnoty** uloží JSON
s odpověďmi a vyhodnocenými doménami — pro tenhle produkt je pole přejmenované
jen významově, ne technicky (sdílí sloupec s aplikací na hodnoty).

## Nasazení (GitHub + Vercel, bez terminálu)

1. Nahraj obsah tohoto repozitáře do nového GitHub repa přes webové rozhraní
   (Add file → Upload files).
2. Ve Vercelu: New Project → Import z GitHubu → vyber repo.
3. Před prvním nasazením (nebo hned po něm) dopl­ň proměnné prostředí výše
   v nastavení projektu.
4. Vercel automaticky rozpozná `/api` složku jako serverless funkce a
   `index.html` jako statickou stránku.
5. Po nasazení otestuj s jedním testovacím kódem ve stavu `Aktivní`, než ho
   pošleš prvnímu klientovi.

## Poznámky k designu

- Otázky i texty výsledků jsou natvrdo v `index.html` (nežijí v Notionu) —
  jsou to fixní, jednou napsané texty, není potřeba je dotahovat při každém
  běhu aplikace.
- Pořadí odpovědí u každé otázky se míchá náhodně pro každého klienta zvlášť.
- Barvy domén (Realizační/Ovlivňovací/Vztahové/Strategické) odpovídají
  oficiální Gallup CliftonStrengths paletě, ne brandové paletě Začni u sebe.
- Klient vidí vždy jen svou nejsilnější doménu nebo kombinaci dvou — ne
  kompletní rozklad všech čtyř skóre.
