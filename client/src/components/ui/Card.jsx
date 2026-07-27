// Semantic container on Cadence tokens, with optional header/footer slots.
// Mirrors the .card class (bg-card + border-rule + rounded-2xl + shadow-card);
// prefer this component in new code. Extra props pass through to the outer div.
export default function Card({ header, footer, className = '', bodyClassName = '', children, ...rest }) {
  return (
    <div className={`bg-card border border-rule rounded-2xl shadow-card ${className}`} {...rest}>
      {header != null && <div className="px-5 py-3 border-b border-divider">{header}</div>}
      <div className={bodyClassName}>{children}</div>
      {footer != null && <div className="px-5 py-3 border-t border-divider">{footer}</div>}
    </div>
  )
}
