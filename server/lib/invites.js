/**
 * Invite tokens — minted here, stored hashed, never recoverable from the row.
 *
 * ── Why hash a token that expires in a week ──
 * `users.invite_token` used to hold the raw token, which is a bearer credential:
 * anyone who can read the row — a support query, a logged statement, a database
 * snapshot, a backup that outlives the invite — can accept the invite and become
 * that person, with whatever role the admin picked. Hashing makes the stored
 * value useless on its own. The plaintext exists exactly once, in the email, and
 * the server never sees it again until someone presents it.
 *
 * SHA-256 with no salt and no stretching is the right choice HERE and would be
 * wrong for a password: the input is 32 bytes of `crypto.randomBytes`, so there
 * is no dictionary to run and nothing for a salt to defend against. Stretching
 * would only slow down the legitimate lookup.
 *
 * ── The prefix is load-bearing ──
 * A raw token and its SHA-256 are BOTH 64 hex characters, so a stored value
 * gives no way to tell whether it has already been hashed. Without a marker the
 * backfill could not be made idempotent — a second run would hash the hash and
 * silently void every outstanding invite. `s256:` makes the two shapes
 * distinguishable, which is what lets the migration carry a `NOT LIKE 's256:%'`
 * guard and lets outstanding invite links keep working across the change.
 */
const crypto = require('crypto');

const PREFIX = 's256:';

/** How long an invite stays good. Shown to the invitee in the email. */
const INVITE_DAYS = 7;

/** The value to STORE for a given plaintext token. */
const hashInviteToken = (token) =>
  PREFIX + crypto.createHash('sha256').update(String(token), 'utf8').digest('hex');

/**
 * Mint one invite.
 * @returns {{token: string, stored: string}} `token` goes in the link and is
 *   never persisted; `stored` is what the row gets.
 */
function newInviteToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, stored: hashInviteToken(token) };
}

/** Has this stored value already been hashed? Used only by the backfill. */
const isHashed = (v) => typeof v === 'string' && v.startsWith(PREFIX);

module.exports = { INVITE_DAYS, hashInviteToken, newInviteToken, isHashed, PREFIX };
