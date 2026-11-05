// Comp Deck relay — Cloudflare Worker
// Holds your API keys so the tablet page never does. Routes:
//   GET  /health            -> checks keys, lists the JustTCG game id used for One Piece
//   POST /identify          -> { image: "<base64 jpeg>" } -> card fields read by Claude
//   GET  /price?q=OP05-119  -> JustTCG prices for that card (all printings/conditions)
//
// Secrets to set in the Worker's Settings > Variables and Secrets:
//   ANTHROPIC_API_KEY   (required)  from console.anthropic.com
//   JUSTTCG_API_KEY     (required)  from justtcg.com
//   APP_PIN             (recommended) any short code; the page sends it as X-Pin so strangers can't use your keys
//   ALLOWED_ORIGINS     (recommended) e.g. https://lazylucariospokemart.github.io  (comma-separate more)
//   MODEL               (optional)  default claude-haiku-5-5; use claude-sonnet-5-5 for harder reads
//   JUSTTCG_GAME        (optional)  override the One Piece game id if auto-detect picks wrong

const JUST = 'https://api.justtcg.com/v1';
const ANTH = 'https://api.anthropic.com/v1/messages';
let gameCache = null; // {id, name, at}

const PROMPT = `You are reading a photo of one ONE PIECE CARD GAME (Bandai) trading card for a card-show price lookup. Read what is printed on the card itself; do not guess from art alone.
Report:
- code: the card number printed in small white text in the bottom-left corner (format like OP05-119, ST01-001, EB01-010, P-001, PRB01-001). Read it character by character from the zoomed strip; common confusions: 0/O, 1/I, 5/S, 8/B. Uppercase. Empty string if not readable.
- name: character/event/stage name as printed.
- set: the set/booster name if you know it from the code (e.g. OP05 = Awakening of the New Era). Empty if unsure.
- rarity: one of C, UC, R, SR, SEC, L, SP, DON!!, P. Read the rarity letters printed right after the card number (e.g. "OP05-119 SEC"). Leaders are L; cards with no number are DON!!.
- finish: "Standard", "Parallel / Alt Art" (different or full artwork from the normal print, often borderless), "Manga Art" (black-and-white manga panel style), "SP Card", "Treasure Rare", or "Promo".
- language: English, Japanese, Chinese, or Other.
- confidence: 0-100 that code+finish are right.
- notes: one short line on anything that affects price (visible damage, stamp, misalignment) or why you are unsure.
- alternatives: up to 3 other {code, finish} candidates if the number is partly hidden or the finish is ambiguous.
Reply with only JSON, no prose: {"code":"","name":"","set":"","rarity":"","finish":"","language":"","confidence":0,"notes":"","alternatives":[{"code":"","finish":""}]}`;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const okOrigin = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? (origin || '*') : 'null',
      'Access-Control-Allow-Headers': 'content-type, x-pin',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Vary': 'Origin',
    };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return json({ error: 'origin_not_allowed', origin }, 403);
    if (env.APP_PIN && req.headers.get('x-pin') !== env.APP_PIN) return json({ error: 'bad_pin' }, 401);

    try {
      if (url.pathname === '/health') {
        const g = await onePieceGame(env).catch(e => ({ error: String(e) }));
        return json({ ok: true, anthropic: !!env.ANTHROPIC_API_KEY, justtcg: !!env.JUSTTCG_API_KEY, model: env.MODEL || 'claude-haiku-5-5', game: g });
      }
      if (url.pathname === '/identify' && req.method === 'POST') {
        if (!env.ANTHROPIC_API_KEY) return json({ error: 'no_anthropic_key' }, 500);
        const body = await req.json().catch(() => ({}));
        const b64 = String(body.image || '').replace(/^data:image\/\w+;base64,/, '');
        if (!b64) return json({ error: 'no_image' }, 400);
        const strip = String(body.strip || '').replace(/^data:image\/\w+;base64,/, '');
        const content = [
          { type: 'text', text: 'Image 1: the whole card.' },
          { type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/jpeg', data: b64 } },
        ];
        if (strip) content.push(
          { type: 'text', text: 'Image 2: a zoomed-in crop of the bottom of the same card, where the card number and rarity letter are printed. Use it to read those exactly.' },
          { type: 'image', source: { type: 'base64', media_type: body.media_type || 'image/jpeg', data: strip } },
        );
        content.push({ type: 'text', text: PROMPT });
        const r = await fetch(ANTH, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: env.MODEL || 'claude-haiku-5-5',
            max_tokens: 1500,
            thinking: { type: 'disabled' },
            messages: [{ role: 'user', content }],
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { console.error('anthropic', r.status, JSON.stringify(data).slice(0, 800), 'img', b64.length, 'strip', strip.length); return json({ error: 'anthropic', detail: data?.error?.message || JSON.stringify(data).slice(0, 300), status: r.status }, 502); }
        const text = (data.content || []).map(c => c.text || '').join('');
        const m = text.match(/\{[\s\S]*\}/);
        let card = null; try { card = JSON.parse(m ? m[0] : text); } catch (e) {}
        if (!card) { console.error('unparseable', JSON.stringify({ stop: data.stop_reason, content: data.content, usage: data.usage, img: b64.length, strip: strip.length, ua: req.headers.get('user-agent') }).slice(0, 1500)); return json({ error: 'unparseable', detail: (data.stop_reason ? 'stop=' + data.stop_reason + ' ' : '') + text.slice(0, 300) }, 502); }
        return json({ card });
      }
      if (url.pathname === '/price' && req.method === 'GET') {
        if (!env.JUSTTCG_API_KEY) return json({ error: 'no_justtcg_key' }, 500);
        const q = (url.searchParams.get('q') || '').trim();
        if (!q) return json({ error: 'no_query' }, 400);
        const game = await onePieceGame(env);
        if (!game?.id) return json({ error: 'game_not_found', detail: game }, 500);
        // Try the printed code as the search text first, then as a card number.
        let cards = await justCards(env, { game: game.id, q, limit: 20 });
        if (!cards.length && /-/.test(q)) {
          const num = q.split('-').pop();
          cards = await justCards(env, { game: game.id, number: num, limit: 40 });
          cards = cards.filter(c => String(c.number || '').toUpperCase().includes(q.toUpperCase()) || String(c.number || '') === num);
        }
        return json({ game: game.id, query: q, cards: cards.map(slim) });
      }
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: 'relay_error', detail: String(e?.message || e) }, 500);
    }
  },
};

async function justGet(env, path, params) {
  const u = new URL(JUST + path);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'x-api-key': env.JUSTTCG_API_KEY, 'accept': 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('JustTCG ' + r.status + ': ' + (data.error || data.message || JSON.stringify(data)).slice(0, 200));
  return data;
}

async function justCards(env, params) {
  const d = await justGet(env, '/cards', params);
  return Array.isArray(d.data) ? d.data : [];
}

async function onePieceGame(env) {
  if (env.JUSTTCG_GAME) return { id: env.JUSTTCG_GAME, name: '(from JUSTTCG_GAME)' };
  if (gameCache && Date.now() - gameCache.at < 6 * 3600e3) return gameCache;
  const d = await justGet(env, '/games');
  const list = Array.isArray(d.data) ? d.data : [];
  const g = list.find(x => /one\s*piece/i.test(x.name || '') || /one-?piece/i.test(x.id || ''));
  gameCache = g ? { id: g.id, name: g.name, at: Date.now() } : { id: null, name: null, at: Date.now(), available: list.map(x => x.id) };
  return gameCache;
}

function slim(c) {
  return {
    id: c.id, name: c.name, set: c.set, number: c.number, rarity: c.rarity, tcgplayerId: c.tcgplayerId,
    variants: (c.variants || []).map(v => ({ condition: v.condition, printing: v.printing, language: v.language, price: v.price, lastUpdated: v.lastUpdated, change7d: v.priceChange7d ?? v['7d'] ?? null })),
  };
}
