// Spotify Web API — client-credentials flow via fetch. Shared platform keys:
// SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET (public catalog data only, no user
// login). Degrades gracefully when unset. Token cached in-memory with early
// expiry.

let cachedToken = null;
let tokenExpiry = 0;

function isEnabled() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

async function token() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const basic = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify auth ${res.status}`);
  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiry = Date.now() + (json.expires_in - 60) * 1000;
  return cachedToken;
}

async function api(path) {
  const t = await token();
  const res = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 429) throw new Error('Spotify rate limited');
  if (!res.ok) throw new Error(`Spotify ${res.status}`);
  return res.json();
}

// Parse a Spotify URI/URL into { type, id } (album or track), or null.
function parseRef(ref) {
  if (!ref) return null;
  let m = ref.match(/spotify:(album|track):([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  m = ref.match(/open\.spotify\.com\/(album|track)\/([A-Za-z0-9]+)/);
  if (m) return { type: m[1], id: m[2] };
  return null;
}

// Largest cover-art URL for a release: from an explicit Spotify URI if present,
// else a best-effort search by artist + title.
async function coverArt({ spotifyUri, title, artist }) {
  const ref = parseRef(spotifyUri);
  let images;
  if (ref) {
    const obj = await api(`/${ref.type}s/${ref.id}`);
    images = ref.type === 'track' ? obj.album?.images : obj.images;
  } else if (title) {
    const q = encodeURIComponent(`${title} ${artist || ''}`.trim());
    const search = await api(`/search?type=album&limit=1&q=${q}`);
    images = search.albums?.items?.[0]?.images;
  }
  if (!images || !images.length) return null;
  return images.sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
}

// Artist profile stats by best-effort name search.
async function artistStats(name) {
  const search = await api(`/search?type=artist&limit=1&q=${encodeURIComponent(name)}`);
  const a = search.artists?.items?.[0];
  if (!a) return null;
  return {
    spotify_followers: a.followers?.total ?? null,
    spotify_popularity: a.popularity ?? null,
    image_url: a.images?.[0]?.url || null,
    spotify_url: a.external_urls?.spotify || null,
    genres: a.genres || [],
  };
}

module.exports = { isEnabled, coverArt, artistStats, parseRef };
