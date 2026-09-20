// Every page header is a walkthrough anchor.
//
// `data-page-header` is emitted ALWAYS, so a tour step has something to point
// at on any page without that page being edited — 51 pages render this
// component, and a tour step is only ever as good as an anchor that exists.
// `tour="ledger"` additionally emits `data-tour="ledger-header"` for steps that
// want to name one page specifically; targets are comma-separated in preference
// order, so a tour can ask for the specific anchor and fall back to the generic.
export default function PageHeader({ title, subtitle, action, tour }) {
  return (
    <div
      className="flex items-start justify-between gap-4 mb-6"
      data-page-header=""
      {...(tour ? { 'data-tour': `${tour}-header` } : {})}
    >
      <div>
        <h1 className="text-xl font-bold text-ink tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}
