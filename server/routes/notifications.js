const express = require('express');
const pool = require('../db');
const authMiddleware = require('../middleware/auth');
const { withTenant } = require('../middleware/tenant');
const { BULK_DEALS_SQL, deriveDeal } = require('../lib/bulkDeals');

const router = express.Router();
router.use(authMiddleware, withTenant);

const CHECKLIST_COLS = [
  'cover_art_received', 'audio_uploaded', 'pitched_spotify', 'pitched_apple',
  'marketing_plan', 'content_ready', 'dsp_email_sent', 'lyrics_submitted',
];

// Severity drives BOTH the icon tint and the order. Without a sort the bell
// listed alerts in whatever order the queries happened to be pushed, so a
// contract expiring in 90 days could sit above a release shipping on Friday
// with no artwork.
const RANK = { danger: 0, warning: 1, info: 2 };

const money = (n, c) => `${c || 'USD'} ${Number(n || 0).toLocaleString()}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// GET /api/notifications — smart alerts computed live from the workspace's own
// data. Nothing is stored; every query is scoped to req.labelId. Role gates
// mirror the pages each alert links to (approvals/contracts are privileged).
//
// Items carry a `group` so the bell can render per-kind sections instead of one
// undifferentiated list — the grouping is a property of the alert, not of the
// component, so /notifications and the dropdown cannot disagree about it.
router.get('/', async (req, res) => {
  try {
    const isApprover = ['Superadmin', 'Admin', 'Approver'].includes(req.user.role);
    const isAdmin = ['Superadmin', 'Admin'].includes(req.user.role);
    const incomplete = CHECKLIST_COLS.map(c => `${c} = FALSE`).join(' OR ');
    const doneExpr = CHECKLIST_COLS.map(c => `(CASE WHEN ${c} THEN 1 ELSE 0 END)`).join(' + ');

    // "Clear all" watermark — computed alerts created on/before this are hidden.
    const wm = (await pool.query('SELECT notifications_cleared_at FROM users WHERE id = $1', [req.user.id])).rows[0]?.notifications_cleared_at || null;

    const none = Promise.resolve({ rows: [] });
    const queries = [
      // [0] Upcoming releases (next 21 days) with an incomplete prep checklist.
      // Completion % rides along so the *same* rows can escalate to the
      // "behind" alert below without a second query that could disagree.
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.created_at, r.assigned_to,
                a.name AS artist_name,
                (${doneExpr}) AS done_count,
                (r.release_date - CURRENT_DATE) AS days_out
         FROM releases r
         LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
         WHERE r.label_id = $1 AND r.status != 'Archived'
           AND r.release_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '21 days'
           AND (${incomplete})
         ORDER BY r.release_date ASC LIMIT 25`,
        [req.labelId]
      ),
      // [1] The caller's own tasks that are overdue or due within 3 days.
      // `is_overdue` is decided HERE, in the same query as the 3-day window, so
      // there is one rule instead of two. It used to be recomputed in JS as
      // `new Date(due_date) < new Date(new Date().toDateString())` — which
      // compares a UTC-parsed date against a locally-parsed one, so east of UTC
      // a task due today read as overdue and the bell nagged a day early.
      pool.query(
        `SELECT id, description, due_date, priority, created_at,
                (due_date < CURRENT_DATE) AS is_overdue
           FROM tasks
         WHERE label_id = $1 AND user_id = $2 AND status != 'Done' AND due_date IS NOT NULL
           AND due_date <= CURRENT_DATE + INTERVAL '3 days'
         ORDER BY due_date ASC LIMIT 25`,
        [req.labelId, req.user.id]
      ),
      // [2] Stalled bulk deals — money out, still under-delivered, nothing
      // received in 30+ days — via lib/bulkDeals, so the bell and /bulk-deals
      // draw their Stalled badge from ONE rule.
      isApprover ? pool.query(BULK_DEALS_SQL, [req.labelId]) : none,

      // [3] SOMEBODY ELSE'S overdue tasks, named. A lead finding out on Monday
      // that a task went red on Thursday is the failure this exists to prevent.
      // Scope is the DEPARTMENT boundary routes/tasks.js already enforces:
      // admins see the workspace, an Approver sees their own department, and
      // anyone else sees nothing (the `else` branch never issues the query).
      isApprover ? pool.query(
        `SELECT t.id, t.description, t.due_date, t.created_at, u.name AS assignee_name
           FROM tasks t JOIN users u ON u.id = t.user_id AND u.label_id = t.label_id
          WHERE t.label_id = $1 AND t.user_id <> $2 AND t.status != 'Done'
            AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
            ${isAdmin ? '' : 'AND u.department = $3'}
          ORDER BY t.due_date ASC LIMIT 15`,
        isAdmin ? [req.labelId, req.user.id] : [req.labelId, req.user.id, req.user.department || '']
      ) : none,

      // [4] Releases inside 30 days with nobody's name on them. An owner-less
      // release is the one nobody notices slipping.
      pool.query(
        `SELECT r.id, r.project_name, r.release_date, r.created_at, a.name AS artist_name,
                (r.release_date - CURRENT_DATE) AS days_out
           FROM releases r
           LEFT JOIN artists a ON a.id = r.artist_id AND a.label_id = r.label_id
          WHERE r.label_id = $1 AND r.status != 'Archived' AND r.assigned_to IS NULL
            AND r.release_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          ORDER BY r.release_date ASC LIMIT 10`,
        [req.labelId]
      ),

      // [5] Rush payment requests still unpaid. Somebody asked for this to jump
      // the queue; a rush nobody sees is just a normal invoice.
      isApprover ? pool.query(
        `SELECT id, payee, amount, currency, rush_reason, rush_by, rush_needed_by, created_at
           FROM expenses
          WHERE label_id = $1 AND rush = TRUE
            AND COALESCE(payment_status, 'Unpaid') <> 'Paid'
            AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
          ORDER BY rush_needed_by ASC NULLS LAST LIMIT 10`,
        [req.labelId]
      ) : none,

      // [6] Artist budgets burning down. The budget is six section numbers per
      // artist (artist_budget_sections); spend is the PAID leaf rows keyed the
      // same canonical way lib/artistKey.js does it, so the alert and
      // /artist-budgets bucket the same invoices under the same artist.
      isApprover ? pool.query(
        `WITH budget AS (
           SELECT artist_key, SUM(amount)::float8 AS budget
             FROM artist_budget_sections WHERE label_id = $1 GROUP BY artist_key
         ), spend AS (
           SELECT regexp_replace(lower(COALESCE(artist, '')), '[^a-z0-9]', '', 'g') AS artist_key,
                  SUM(COALESCE(amount, 0))::float8 AS spent,
                  MAX(artist) AS display_name
             FROM expenses
            WHERE label_id = $1 AND status = 'approved' AND payment_status = 'Paid'
              AND (deleted = false OR deleted IS NULL) AND (voided = false OR voided IS NULL)
              AND NOT EXISTS (SELECT 1 FROM expenses c WHERE c.parent_id = expenses.id AND c.label_id = expenses.label_id)
              AND artist IS NOT NULL AND artist <> ''
            GROUP BY 1
         )
         SELECT b.artist_key, b.budget, COALESCE(s.spent, 0) AS spent, s.display_name
           FROM budget b LEFT JOIN spend s ON s.artist_key = b.artist_key
          WHERE b.budget > 0 AND COALESCE(s.spent, 0) >= b.budget * 0.8
          ORDER BY (COALESCE(s.spent, 0) / b.budget) DESC LIMIT 10`,
        [req.labelId]
      ) : none,

      // [7] Contract renewals worth acting on: expiring inside 90 days AND the
      // artist still has unreleased material. The count is the argument.
      isApprover ? pool.query(
        `SELECT c.id, c.type, c.expiration_date, c.created_at, a.name AS artist_name,
                (c.expiration_date - CURRENT_DATE) AS days_left,
                (SELECT COUNT(*)::int FROM releases r
                  WHERE r.artist_id = c.artist_id AND r.label_id = c.label_id
                    AND (r.archived = false OR r.archived IS NULL)
                    AND (r.release_date IS NULL OR r.release_date > CURRENT_DATE)) AS unreleased
           FROM contracts c
           LEFT JOIN artists a ON a.id = c.artist_id AND a.label_id = c.label_id
          WHERE c.label_id = $1 AND c.status = 'Active' AND c.expiration_date IS NOT NULL
            AND c.expiration_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '90 days'
          ORDER BY c.expiration_date ASC LIMIT 25`,
        [req.labelId]
      ) : none,
    ];

    if (isApprover) {
      queries.push(pool.query(
        `SELECT id, payee, amount, currency, vendor_submitted, created_at FROM expenses
         WHERE label_id = $1 AND status = 'pending' AND (deleted = false OR deleted IS NULL)
         ORDER BY created_at DESC LIMIT 25`,
        [req.labelId]
      ));
    }

    // Unread persisted @mentions for the caller (everyone).
    queries.push(pool.query(
      `SELECT m.id, m.snippet, m.link, m.created_at, u.name AS actor_name
         FROM user_mentions m LEFT JOIN users u ON u.id = m.actor_id AND u.label_id = m.label_id
        WHERE m.label_id = $1 AND m.mentioned_user_id = $2 AND m.read_at IS NULL
        ORDER BY m.created_at DESC LIMIT 25`,
      [req.labelId, req.user.id]
    ));

    // Due personal reminders (statement uploads etc.) — an overdue reminder
    // stays due until "Done" advances it, so the clear-all watermark does not
    // hide it. Table may predate the migration on a mid-deploy request.
    queries.push(pool.query(
      `SELECT id, title, link, next_due FROM statement_reminders
        WHERE label_id = $1 AND user_id = $2 AND active = TRUE AND next_due <= CURRENT_DATE
        ORDER BY next_due ASC LIMIT 10`,
      [req.labelId, req.user.id]
    ).catch(() => ({ rows: [] })));

    const results = await Promise.all(queries);
    const releases = results[0].rows;
    const tasks = results[1].rows;
    const bulkDeals = results[2].rows;
    const teamTasks = results[3].rows;
    const unassigned = results[4].rows;
    const rushes = results[5].rows;
    const budgets = results[6].rows;
    const contracts = results[7].rows;
    let idx = 8;
    const approvals = isApprover ? results[idx++].rows : [];
    const mentions = results[idx++].rows;
    const reminders = results[idx++].rows;

    // A computed alert is hidden if its underlying row predates the clear-all
    // watermark. Mentions and reminders never pass through here.
    const cleared = (createdAt) => wm && createdAt && new Date(createdAt) <= new Date(wm);
    const smart = [];
    const push = (o) => smart.push(o);

    // ── Releases ────────────────────────────────────────────────────────────
    // One dataset, two outcomes: inside a week and under half done is an
    // escalation with advice; everything else is the plain upcoming row. Two
    // queries would have let the same release appear in both sections.
    const TOTAL_STEPS = CHECKLIST_COLS.length;
    for (const r of releases) {
      if (cleared(r.created_at)) continue;
      const pct = Math.round((Number(r.done_count || 0) / TOTAL_STEPS) * 100);
      const days = Number(r.days_out);
      const name = [r.artist_name, r.project_name].filter(Boolean).join(' — ');
      if (days <= 7 && pct < 50) {
        push({
          type: 'release_behind', group: 'smart', key: `release-behind-${r.id}`,
          title: `${name} is ${plural(days, 'day', 'days')} out with only ${pct}% of the checklist done — flag to the team`,
          detail: 'Release behind', date: r.release_date, link: `/releases/${r.id}`,
          severity: days <= 3 ? 'danger' : 'warning',
        });
      } else {
        push({
          type: 'release', group: 'releases', key: `release-${r.id}`,
          title: name, detail: `Checklist ${pct}% complete`, date: r.release_date,
          link: `/releases/${r.id}`, severity: 'warning', days_out: days, pct,
        });
      }
    }
    for (const r of unassigned) {
      if (cleared(r.created_at)) continue;
      push({
        type: 'release_unassigned', group: 'smart', key: `release-unassigned-${r.id}`,
        title: `${[r.artist_name, r.project_name].filter(Boolean).join(' — ')} ships in ${plural(Number(r.days_out), 'day', 'days')} and has no owner`,
        detail: 'Unassigned release', date: r.release_date, link: `/releases/${r.id}`, severity: 'warning',
      });
    }

    // ── Tasks ───────────────────────────────────────────────────────────────
    for (const t of tasks) {
      if (cleared(t.created_at)) continue;
      push({
        type: 'task', group: 'tasks', key: `task-${t.id}`, title: t.description,
        detail: t.is_overdue ? 'Task overdue' : 'Task due soon', date: t.due_date,
        link: '/my-work', severity: t.is_overdue ? 'danger' : 'warning',
      });
    }
    for (const t of teamTasks) {
      if (cleared(t.created_at)) continue;
      push({
        type: 'task_overdue', group: 'smart', key: `team-task-${t.id}`,
        title: `${t.assignee_name || 'Someone'}'s task "${t.description}" is overdue`,
        detail: 'Team task overdue', date: t.due_date, link: '/team-work', severity: 'danger',
      });
    }

    // ── Money ───────────────────────────────────────────────────────────────
    const nowMs = Date.now();
    for (const raw of bulkDeals) {
      if (cleared(raw.created_at)) continue;
      const b = deriveDeal(raw, nowMs);
      if (!b.stalled) continue;
      push({
        type: 'bulk_deal', group: 'smart', key: `bulkdeal-${b.id}`,
        title: `${b.payee || 'Bulk deal'} · ${money(b.deal_total, b.currency)} looks stalled — ${b.paid_pct}% paid, ${b.delivered}/${b.contracted || '?'} ${b.bulk_deal_unit || 'deliverables'} received, nothing new in ${b.stalled_days} days`,
        detail: 'Bulk deal stalled', date: b.invoice_date, link: '/bulk-deals', severity: 'danger',
      });
    }
    for (const r of rushes) {
      if (cleared(r.created_at)) continue;
      push({
        type: 'payment_rush', group: 'smart', key: `rush-${r.id}`,
        title: `${r.rush_by || 'Someone'} requested a rush payment for ${r.payee} (${money(r.amount, r.currency)})${r.rush_reason ? ` — "${r.rush_reason}"` : ''}`,
        detail: 'Rush payment', date: r.rush_needed_by, link: '/payments?filter=rush', severity: 'danger',
      });
    }
    for (const b of budgets) {
      const pct = Math.round((b.spent / b.budget) * 100);
      push({
        type: 'budget_burn', group: 'budget', key: `budget-${b.artist_key}`,
        title: `${b.display_name || b.artist_key} has spent ${pct}% of budget (${money(b.spent)} of ${money(b.budget)})`,
        detail: 'Budget alert', date: null, link: '/artist-budgets',
        severity: pct >= 100 ? 'danger' : 'warning', pct,
      });
    }

    // ── Contracts ───────────────────────────────────────────────────────────
    // A contract with unreleased material behind it is a renewal decision;
    // one without is a diary entry. Same row, two different pieces of news.
    for (const c of contracts) {
      if (cleared(c.created_at)) continue;
      const days = Number(c.days_left);
      const who = [c.artist_name, c.type].filter(Boolean).join(' ');
      if (Number(c.unreleased) > 0) {
        push({
          type: 'contract_renewal', group: 'smart', key: `contract-renewal-${c.id}`,
          title: `${c.artist_name || 'Contract'}'s contract expires in ${plural(days, 'day', 'days')} and they have ${plural(Number(c.unreleased), 'unreleased release', 'unreleased releases')} — consider renewal`,
          detail: 'Renewal decision', date: c.expiration_date, link: '/renewals',
          severity: days <= 30 ? 'danger' : 'warning',
        });
      } else {
        push({
          type: 'contract', group: 'contracts', key: `contract-${c.id}`,
          title: who, detail: `Expires in ${plural(days, 'day', 'days')}`, date: c.expiration_date,
          link: '/renewals', severity: days <= 30 ? 'danger' : 'warning', days_left: days,
        });
      }
    }

    // ── Approvals ───────────────────────────────────────────────────────────
    // Vendor submissions are their OWN news: somebody outside the workspace
    // filed a bill and is waiting on an answer. Internal pending rows are a
    // worklist. Both deep-link to /approvals — the dedicated page — not to the
    // ledger, which is where they used to land despite /approvals existing.
    for (const e of approvals) {
      if (cleared(e.created_at)) continue;
      push(e.vendor_submitted ? {
        type: 'vendor_submission', group: 'vendor', key: `approval-${e.id}`,
        title: `${e.payee || 'Vendor'} · ${money(e.amount, e.currency)}`,
        detail: 'Vendor submission', date: e.created_at, link: '/approvals', severity: 'info',
      } : {
        type: 'approval', group: 'approvals', key: `approval-${e.id}`,
        title: `${e.payee || 'Expense'} · ${money(e.amount, e.currency)}`,
        detail: 'Awaiting approval', date: e.created_at, link: '/approvals', severity: 'info',
      });
    }

    for (const r of reminders) {
      push({
        type: 'reminder', group: 'reminders', key: `reminder-${r.id}`, reminderId: r.id,
        title: r.title, detail: 'Reminder due', date: r.next_due,
        link: r.link || '/bank-statements', severity: 'info',
      });
    }

    smart.sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3));

    const mentionItems = mentions.map(m => ({
      type: 'mention', group: 'mentions', key: `mention-${m.id}`, mentionId: m.id,
      title: `${m.actor_name || 'Someone'} mentioned you`, detail: m.snippet,
      date: m.created_at, link: m.link || '/', severity: 'info',
    }));

    // Flat `items` (mentions first) for the bell; the structured groups feed
    // the /notifications page and the bell's section headers.
    const items = [...mentionItems, ...smart];
    const of = (...types) => smart.filter(i => types.includes(i.type));
    res.json({ success: true, data: {
      count: items.length, total_count: items.length, items,
      mentions: mentionItems,
      smart_alerts: smart.filter(i => i.group === 'smart'),
      releases: of('release'), contracts: of('contract'),
      budget_alerts: of('budget_burn'),
      vendor_submissions: of('vendor_submission'),
      approvals: of('approval'),
      tasks: of('task'),
      reminders: of('reminder'),
    } });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/notifications/mentions/read — mark one (by id) or all read.
router.post('/mentions/read', async (req, res) => {
  try {
    if (req.body.id) {
      await pool.query(
        'UPDATE user_mentions SET read_at = NOW() WHERE id = $1 AND mentioned_user_id = $2 AND label_id = $3',
        [parseInt(req.body.id, 10), req.user.id, req.labelId]
      );
    } else {
      await pool.query(
        'UPDATE user_mentions SET read_at = NOW() WHERE mentioned_user_id = $1 AND label_id = $2 AND read_at IS NULL',
        [req.user.id, req.labelId]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Mark mention read error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/notifications/clear — watermark computed alerts as seen. Mentions
// are individually actionable and are deliberately NOT cleared here.
router.post('/clear', async (req, res) => {
  try {
    await pool.query('UPDATE users SET notifications_cleared_at = NOW() WHERE id = $1', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    console.error('Clear notifications error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
