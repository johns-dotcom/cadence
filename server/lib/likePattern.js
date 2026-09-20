// A user's search text, turned into a SQL LIKE/ILIKE pattern that matches
// exactly what they typed.
//
// `_` is a single-character wildcard and `%` matches any run, so an unescaped
// query searches for something the user did not ask for: "a_b" matched "axb",
// and a query of "%%" matched every message they can read. Pair with
// `ESCAPE '\'` (LIKE_ESCAPE) in the SQL — the escape character is not implied.
const LIKE_ESCAPE = "ESCAPE '\\'";

function likeContains(q) {
  return `%${String(q).replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}

module.exports = { likeContains, LIKE_ESCAPE };
