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
// Accepts spotify:album:x / spotify:track:x (case-insensitive), open/play
// .spotify.com URLs with or without protocol or ?si= query params.
function parseRef(ref) {
  if (!ref) return null;
  const s = String(ref).trim();
  if (!s) return null;
  let m = s.match(/^spotify:(album|track):([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
  m = s.match(/(?:https?:\/\/)?(?:open\.|play\.)?spotify\.com\/(album|track)\/([A-Za-z0-9]+)/i);
  if (m) return { type: m[1].toLowerCase(), id: m[2] };
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

// Artist by Spotify id — the exact lookup, used when the roster row already
// stores a Spotify profile URL. Returns null on a 404 (permanent), throws on
// transient failures so a batch sync can leave the row for the next run.
async function artistById(id) {
  if (!id) return null;
  const t = await token();
  const res = await fetch(`https://api.spotify.com/v1/artists/${id}`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Spotify ${res.status} for artist ${id}`);
  const a = await res.json();
  return {
    id: a.id,
    name: a.name,
    spotify_followers: a.followers?.total ?? null,
    spotify_popularity: a.popularity ?? null,
    image_url: a.images?.[0]?.url || null,
    spotify_url: a.external_urls?.spotify || null,
    genres: a.genres || [],
  };
}

// Parse an artist id out of a Spotify profile URL/URI.
function parseArtistRef(ref) {
  if (!ref) return null;
  const s = String(ref).trim();
  let m = s.match(/^spotify:artist:([A-Za-z0-9]+)/i);
  if (m) return m[1];
  m = s.match(/(?:https?:\/\/)?(?:open\.|play\.)?spotify\.com\/artist\/([A-Za-z0-9]+)/i);
  return m ? m[1] : null;
}

// Full live artist surface for the profile page: profile + top tracks +
// discography, fanned out at request time. Resolves the artist by stored URL
// first (exact) then by name search. Returns null when nothing matches.
//
// Albums paginate 3 pages deep (150 items) — enough for any roster artist, and
// bounded so one prolific act can't stall the request.
async function artistProfile({ name, url }) {
  let profile = null;
  const refId = parseArtistRef(url);
  if (refId) profile = await artistById(refId).catch(() => null);
  if (!profile) {
    const search = await api(`/search?type=artist&limit=1&q=${encodeURIComponent(name || '')}`);
    const a = search.artists?.items?.[0];
    if (!a) return null;
    profile = {
      id: a.id, name: a.name,
      spotify_followers: a.followers?.total ?? null,
      spotify_popularity: a.popularity ?? null,
      image_url: a.images?.[0]?.url || null,
      spotify_url: a.external_urls?.spotify || null,
      genres: a.genres || [],
    };
  }

  // Top tracks and albums are independent — one failing shouldn't blank the
  // other, so each degrades to an empty list.
  const [top, albums] = await Promise.all([
    api(`/artists/${profile.id}/top-tracks?market=US`).catch(() => ({ tracks: [] })),
    (async () => {
      const out = [];
      for (let page = 0; page < 3; page++) {
        const r = await api(`/artists/${profile.id}/albums?include_groups=album,single&limit=50&offset=${page * 50}&market=US`);
        out.push(...(r.items || []));
        if (!r.next) break;
      }
      return out;
    })().catch(() => []),
  ]);

  // Spotify returns the same record once per market/edition; fold by name.
  const seen = new Set();
  const discography = [];
  for (const al of albums) {
    const key = (al.name || '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    discography.push({
      id: al.id,
      name: al.name,
      group: al.album_group || al.album_type,
      release_date: al.release_date || null,
      image_url: al.images?.[0]?.url || null,
      url: al.external_urls?.spotify || null,
    });
  }
  discography.sort((a, b) => String(b.release_date || '').localeCompare(String(a.release_date || '')));

  return {
    ...profile,
    markets: profile.markets ?? null,
    top_tracks: (top.tracks || []).slice(0, 10).map(t => ({
      id: t.id,
      name: t.name,
      popularity: t.popularity ?? 0,
      album: t.album?.name || null,
      image_url: t.album?.images?.[t.album.images.length - 1]?.url || null,
      url: t.external_urls?.spotify || null,
    })),
    tracks_found: (top.tracks || []).length,
    discography: discography.slice(0, 18),
    album_count: discography.filter(d => d.group === 'album').length,
    single_count: discography.filter(d => d.group === 'single').length,
  };
}

// ---- Bulk artwork sync helpers (two-phase, used by POST /releases/sync-artwork) ----
// Contract: return the image URL on success, null when the miss is PERMANENT
// (unparseable ref, Spotify 404, confidently no match) so callers can stamp the
// 'not_found' sentinel, and THROW on transient failures (rate limit, 5xx,
// network) so the row stays NULL and a later sync retries it.

// Phase 1: cover art from an explicit Spotify URI/URL.
async function artworkByRef(spotifyUri) {
  const ref = parseRef(spotifyUri);
  if (!ref) return null; // format we can't recognize — permanent
  const t = await token();
  const res = await fetch(`https://api.spotify.com/v1/${ref.type}s/${ref.id}`, { headers: { Authorization: `Bearer ${t}` } });
  if (res.status === 404) return null; // Spotify doesn't know this id — permanent
  if (!res.ok) throw new Error(`Spotify ${res.status} for ${spotifyUri}`); // transient
  const obj = await res.json();
  const images = ref.type === 'track' ? obj.album?.images : obj.images;
  if (!images || !images.length) return null;
  return images.slice().sort((a, b) => (b.width || 0) - (a.width || 0))[0].url;
}

// Normalize for comparison: lowercase, strip punctuation, collapse whitespace.
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Does `candidate` match `wanted` strongly enough to trust the cover? Exact
// after normalization, or a substring either way when the shorter side is
// long enough to be meaningful.
function strongMatch(candidate, wanted, minLen) {
  const c = normalize(candidate);
  const w = normalize(wanted);
  if (!c || !w) return false;
  if (c === w) return true;
  if (w.length >= minLen && c.includes(w)) return true;
  if (c.length >= minLen && w.includes(c)) return true;
  return false;
}

// Phase 2: strict search by artist + title. Only returns a URL when BOTH match
// confidently — otherwise null, so the UI shows a placeholder instead of an
// unrelated cover from Spotify's top search result. api() throws on non-2xx,
// which is exactly the transient contract we want here.
async function searchArtwork(artist, title) {
  if (!artist || !title) return null;
  const q = encodeURIComponent(`${title} ${artist}`);

  const albumData = await api(`/search?type=album&limit=20&q=${q}`);
  const albumMatch = (albumData.albums?.items || []).find(a =>
    strongMatch(a.name, title, 4) && a.artists?.some(ar => strongMatch(ar.name, artist, 3)));
  if (albumMatch?.images?.[0]?.url) return albumMatch.images[0].url;

  // Fallback: track search (singles released as tracks, not albums).
  const trackData = await api(`/search?type=track&limit=20&q=${q}`);
  const trackMatch = (trackData.tracks?.items || []).find(t =>
    strongMatch(t.name, title, 4) && t.artists?.some(ar => strongMatch(ar.name, artist, 3)));
  if (trackMatch?.album?.images?.[0]?.url) return trackMatch.album.images[0].url;

  return null; // no confident match across either index — permanent
}

module.exports = { isEnabled, coverArt, artistStats, artistById, artistProfile, parseRef, parseArtistRef, artworkByRef, searchArtwork };
