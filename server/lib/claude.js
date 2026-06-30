// Claude (Anthropic) integration — raw HTTPS via fetch (no SDK, matching the
// rest of this codebase's integration style). Shared platform key:
// ANTHROPIC_API_KEY. Degrades gracefully when unset so AI features are simply
// unavailable rather than breaking the request.
//
// Model defaults to claude-opus-4-8 (override with ANTHROPIC_MODEL). For
// cost-sensitive high-volume document parsing an operator may set
// ANTHROPIC_MODEL=claude-sonnet-4-6.

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API = 'https://api.anthropic.com/v1/messages';

function isEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Map a stored file to a Claude content block. PDFs use a `document` block;
// images use an `image` block. Returns null for unsupported types.
function fileBlock(buffer, mimeType) {
  const b64 = buffer.toString('base64');
  if (mimeType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
  }
  if (/^image\/(png|jpeg|jpg|gif|webp)$/.test(mimeType || '')) {
    const mt = mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    return { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } };
  }
  return null;
}

// Low-level call. `content` is the user message content array. When `schema`
// is given, the response is constrained to that JSON Schema and parsed.
// Returns { ok, data?, text?, error?, disabled? }.
async function callClaude({ system, content, schema, maxTokens = 2048 }) {
  if (!isEnabled()) return { ok: false, disabled: true, error: 'AI not configured' };
  try {
    const body = {
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
    };
    if (system) body.system = system;
    if (schema) body.output_config = { format: { type: 'json_schema', schema } };

    const res = await fetch(API, {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Claude ${res.status}: ${detail.slice(0, 200)}` };
    }
    const json = await res.json();
    const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    if (schema) {
      try { return { ok: true, data: JSON.parse(text), text }; }
      catch { return { ok: false, error: 'Model did not return valid JSON', text }; }
    }
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Extract structured data from an uploaded document/image (invoice, W9, etc.).
async function extractFromFile({ buffer, mimeType, instruction, schema, maxTokens }) {
  const block = fileBlock(buffer, mimeType);
  if (!block) return { ok: false, error: 'Unsupported file type for AI extraction' };
  return callClaude({
    content: [block, { type: 'text', text: instruction }],
    schema,
    maxTokens,
  });
}

module.exports = { isEnabled, callClaude, extractFromFile, fileBlock, MODEL };
