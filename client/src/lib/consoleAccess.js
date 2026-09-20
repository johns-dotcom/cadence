// Can this operator see this console page? ONE definition.
//
// There were three, and two were wrong. The rule is NOT "is it on the
// allowlist" — the allowlist only ever contains RESTRICTABLE pages (the server
// filters it to those), so testing membership hid every page that cannot be
// restricted at all. A restricted operator lost My Work and Analytics from the
// rail, and the walkthrough's own copy additionally dropped Messages.
//
// The rule: a page is visible unless it is restrictable AND not granted.
export function consoleCanSee(path, access) {
  const pages = access?.pages
  if (!pages) return true                                   // unrestricted operator
  const restrictable = access?.restrictablePages
  // Without the server's list, fall back to "granted or always-on" rather than
  // hiding things we cannot classify.
  if (!Array.isArray(restrictable)) return path === '/' || path === '/account' || pages.includes(path)
  if (!restrictable.includes(path)) return true             // not restrictable → always visible
  return pages.includes(path)
}
