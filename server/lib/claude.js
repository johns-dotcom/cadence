// Claude (Anthropic) integration — raw HTTPS via fetch (no SDK, matching the
// rest of this codebase's integration style). Shared platform key:
// ANTHROPIC_API_KEY. Degrades gracefully when unset so AI features are simply
// unavailable rather than breaking the request.
//
// Model defaults to claude-opus-4-8 (override with ANTHROPIC_MODEL). For
// cost-sensitive high-volume document parsing an operator may set
// ANTHROPIC_MODEL=claude-sonnet-4-6.

const aiUsage = require('./aiUsage');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-8';
const API = 'https://api.anthropic.com/v1/messages';

// Accept either env var name (CLAUDE_API_KEY is what some hosts default to).
function apiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || '';
}
function isEnabled() {
  return !!apiKey();
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

  // Per-workspace monthly usage cap (labelId comes from the async-local
  // request context set by withTenant; null when unattributable, e.g. public
  // vendor form — those are already IP rate-limited).
  const labelId = aiUsage.currentLabelId();
  if (labelId) {
    const q = await aiUsage.check(labelId);
    if (!q.ok) {
      const unit = q.type === 'tokens' ? 'tokens' : 'requests';
      return { ok: false, limitReached: true, error: `This workspace has reached its monthly AI limit (${Number(q.limit).toLocaleString()} ${unit}). It resets at the start of next month, or an operator can raise it.` };
    }
  }

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
        'x-api-key': apiKey(),
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
    // Meter usage (best-effort; never blocks the response).
    if (labelId) aiUsage.record(labelId, { input: json.usage?.input_tokens, output: json.usage?.output_tokens });
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

// Streaming text completion for LONG outputs (bank-statement parsing). The API
// refuses non-streaming calls that could exceed 10 min at high max_tokens, so
// dense statements MUST stream. Parses the SSE feed by hand (raw fetch, no
// SDK), accumulating text deltas and capturing the final usage + stop_reason.
// Returns { ok, text, output_tokens, stop_reason, error? }.
async function streamText({ system, content, maxTokens = 32000 }) {
  if (!isEnabled()) return { ok: false, disabled: true, error: 'AI not configured' };
  const labelId = aiUsage.currentLabelId();
  if (labelId) {
    const q = await aiUsage.check(labelId);
    if (!q.ok) return { ok: false, limitReached: true, error: 'Workspace AI limit reached' };
  }
  try {
    const body = { model: MODEL, max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content }] };
    if (system) body.system = system;
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      return { ok: false, error: `Claude ${res.status}: ${detail.slice(0, 200)}` };
    }
    let text = '';
    let outputTokens = 0;
    let stopReason = null;
    let buf = '';
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    const handleLine = (line) => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      let evt;
      try { evt = JSON.parse(payload); } catch { return; }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') text += evt.delta.text;
      else if (evt.type === 'message_delta') {
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage?.output_tokens) outputTokens = evt.usage.output_tokens;
      } else if (evt.type === 'message_start' && evt.message?.usage?.output_tokens) {
        outputTokens = evt.message.usage.output_tokens;
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl).trim());
        buf = buf.slice(nl + 1);
      }
    }
    if (buf.trim()) handleLine(buf.trim());
    if (labelId) aiUsage.record(labelId, { output: outputTokens });
    return { ok: true, text: text.trim(), output_tokens: outputTokens, stop_reason: stopReason };
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

// ── Domain helpers ───────────────────────────────────────────────────────
// Structured-output schemas use nullable types + additionalProperties:false
// and list every property in `required` (strict-mode requirement).

const nullableStr = { type: ['string', 'null'] };

const INVOICE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    vendor_name: nullableStr,
    amount: { type: ['number', 'null'] },
    currency: nullableStr,
    invoice_number: nullableStr,
    invoice_date: nullableStr,
    description: nullableStr,
    category: nullableStr,
    payment_method: nullableStr,
  },
  required: ['vendor_name', 'amount', 'currency', 'invoice_number', 'invoice_date', 'description', 'category', 'payment_method'],
};

// Draft a contract clause from a kind + freeform context. Plain-prose output
// (no schema). Returns { ok, text?, disabled?, error? }.
function draftClause({ kind, context, labelName }) {
  const system = 'You are a music-industry legal assistant helping a record label draft contract clauses. '
    + 'Write clear, professional, plain-English clause text suitable for a recording or artist agreement. '
    + 'Output ONLY the clause text itself — no headings, preamble, disclaimers, or markdown. '
    + 'Keep it balanced and reasonable; do not invent specific dollar figures or dates unless supplied in the context.';
  const text = `Draft a "${kind}" clause${labelName ? ` for ${labelName}` : ''}.`
    + (context && String(context).trim() ? ` Context / terms to incorporate: ${String(context).trim()}` : '');
  return callClaude({ system, content: [{ type: 'text', text }], maxTokens: 900 });
}

// Parse an invoice document/image into structured fields for auto-fill.
function parseInvoice({ buffer, mimeType }) {
  return extractFromFile({
    buffer, mimeType, schema: INVOICE_SCHEMA, maxTokens: 1024,
    instruction: 'Extract the invoice details. invoice_date as YYYY-MM-DD. amount is the total due as a number (no symbols). currency as a 3-letter ISO code. payment_method is the requested method if stated (ACH, Wire, Check, PayPal, etc.), else null. category is a short expense category if obvious, else null. Use null for anything not present.',
  });
}

const DISCREPANCY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    discrepancies: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { field: { type: 'string' }, severity: { type: 'string' }, detail: { type: 'string' } },
        required: ['field', 'severity', 'detail'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['discrepancies', 'summary'],
};

// Compare an uploaded invoice against the recorded entry; flag mismatches.
function scanInvoice({ buffer, mimeType, entry }) {
  const recorded = `Recorded values — payee: ${entry.payee || ''}; amount: ${entry.amount || ''} ${entry.currency || ''}; invoice number: ${entry.invoice_number || ''}.`;
  return extractFromFile({
    buffer, mimeType, schema: DISCREPANCY_SCHEMA, maxTokens: 1024,
    instruction: `${recorded}\nCompare these to the attached invoice. List any discrepancies (field, severity high|medium|low, detail). Be tolerant of formatting (e.g. "INV-0034" ≡ "34"). Empty list if everything matches.`,
  });
}

const W9_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    form_type: nullableStr,
    legal_name: nullableStr,
    name_matches: { type: ['boolean', 'null'] },
    has_signature: { type: ['boolean', 'null'] },
    notes: nullableStr,
  },
  required: ['form_type', 'legal_name', 'name_matches', 'has_signature', 'notes'],
};

// Validate a W9/W8 against an expected vendor name.
function validateW9({ buffer, mimeType, vendorName }) {
  return extractFromFile({
    buffer, mimeType, schema: W9_SCHEMA, maxTokens: 1024,
    instruction: `Identify this US tax form. form_type: W-9 | W-8BEN | W-8BEN-E | other. legal_name: the name on the form. name_matches: does it reasonably match "${vendorName}" (tolerate middle names / business names)? has_signature: is it signed? notes: anything notable.`,
  });
}

const MARKETING_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    campaign_name: nullableStr,
    platform: nullableStr,
    total_budget: { type: ['number', 'null'] },
    creators: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        properties: { name: nullableStr, handle: nullableStr, price: { type: ['number', 'null'] }, followers: { type: ['number', 'null'] } },
        required: ['name', 'handle', 'price', 'followers'],
      },
    },
  },
  required: ['campaign_name', 'platform', 'total_budget', 'creators'],
};

// Parse a marketing/influencer campaign screenshot into structured data.
function parseMarketing({ buffer, mimeType }) {
  return extractFromFile({
    buffer, mimeType, schema: MARKETING_SCHEMA, maxTokens: 2048,
    instruction: 'Extract the campaign name, platform, total budget (number), and the list of creators (name, @handle, price as a number, follower count). Use null for anything not present.',
  });
}

module.exports = { isEnabled, callClaude, streamText, extractFromFile, fileBlock, MODEL, parseInvoice, scanInvoice, validateW9, parseMarketing, draftClause };
