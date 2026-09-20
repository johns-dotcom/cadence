/**
 * A workspace's business timezone — ONE key, one reader.
 *
 * There were two. `labels.settings.business_tz` anchored invoice dates (a
 * "June 10" deadline has to mean the label's June 10, not UTC's), while
 * payment-analytics read `labels.settings.timezone` to anchor its Mon–Sun week
 * boundaries. Both defaulted to America/Los_Angeles, so they agreed by accident
 * and only by accident: the moment anybody set one, a workspace's invoice due
 * dates and its analytics weeks would anchor to different zones, silently, with
 * no UI to reveal either.
 *
 * `business_tz` wins because it is the one with readers, documentation and a
 * shipped meaning. `timezone` is still honoured as a fallback so a workspace
 * that set it out-of-band is not quietly moved.
 */
const pool = require('../db');

const DEFAULT_TZ = 'America/Los_Angeles';

// A zone Intl cannot format is a zone Postgres may also reject, and a bad one
// here would throw inside a date calculation rather than at the point somebody
// typed it.
function isValidTz(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; }
  catch { return false; }
}

async function labelTz(labelId) {
  if (!labelId) return DEFAULT_TZ;
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(settings->>'business_tz',''), NULLIF(settings->>'timezone',''), $2) AS tz
         FROM labels WHERE id = $1`,
      [labelId, DEFAULT_TZ]
    );
    const tz = rows[0]?.tz;
    return isValidTz(tz) ? tz : DEFAULT_TZ;
  } catch { return DEFAULT_TZ; }
}

module.exports = { labelTz, isValidTz, DEFAULT_TZ };
