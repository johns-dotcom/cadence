const express = require('express');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const claude = require('../lib/claude');

const router = express.Router();
router.use(authMiddleware, withTenant);

// POST /api/manual/ask — free-form help, scoped to what the user can access.
// Degrades gracefully (503) when no AI key is configured.
router.post('/ask', async (req, res) => {
  try {
    let question = String(req.body.question || '').trim();
    if (!question) return res.status(400).json({ success: false, error: 'A question is required' });
    question = question.slice(0, 500);
    if (!claude.isEnabled()) {
      return res.status(503).json({ success: false, error: "AI help isn't set up in this workspace yet — browse the guide below." });
    }
    const role = String(req.body.role || 'User');
    const dept = String(req.body.department || '');
    const pages = Array.isArray(req.body.pages) ? req.body.pages.slice(0, 40).map(String) : [];

    const system = 'You are the built-in help assistant for Cadence, a SaaS for record labels covering releases, A&R deals, contracts/legal, and finance/bookkeeping. '
      + 'Answer the user\'s question concisely and practically — 1–3 short paragraphs or a brief bullet list, no preamble. '
      + `The user's role is ${role}${dept ? ` in the ${dept} department` : ''}. `
      + `Only reference features they can access: ${pages.join(', ') || 'the standard workspace pages'}. `
      + 'If the question falls outside those features or the product, say so briefly and suggest asking a workspace admin. Never invent features.';

    const result = await claude.callClaude({ system, content: [{ type: 'text', text: question }], maxTokens: 700 });
    if (!result.ok) return res.status(502).json({ success: false, error: result.error || 'Could not get an answer right now.' });
    res.json({ success: true, data: { answer: result.text } });
  } catch (error) {
    console.error('Manual ask error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
