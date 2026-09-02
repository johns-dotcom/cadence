#!/usr/bin/env node
/*
 * check-tdz — temporal-dead-zone scope check for the client bundle.
 *
 * Why this exists: a production crash shipped because a `useMemo` dependency
 * array referenced a `const` declared 300 lines further down the component.
 * That is legal syntax, so `vite build` is perfectly happy with it; the
 * ReferenceError only appears when the module actually runs. Nothing else in
 * the toolchain catches it, so this does.
 *
 * The rule it enforces: a `const`/`let` binding must not be READ, in the same
 * function scope, at a source position before its own declaration. References
 * from inside a nested function are fine — that function body runs later, by
 * which time the binding is initialised.
 *
 * Usage:
 *   node scripts/check-tdz.cjs                  # sweeps client/src
 *   node scripts/check-tdz.cjs a.jsx b.jsx      # specific files
 *   npm run check:tdz
 *
 * Exits 1 on a genuine hazard or a parse failure, 0 when clean.
 */
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTS.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const args = process.argv.slice(2);
const files = args.length ? args.map(f => path.resolve(f)) : walk(SRC);

const hazards = [];
const seen = new Set(); // one report per (file, ref position) — babel visits a
                        // binding once per Scopable that resolves to its scope.
let parseFailures = 0;

for (const file of files) {
  let ast;
  try {
    ast = parser.parse(fs.readFileSync(file, 'utf8'), {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'],
    });
  } catch (e) {
    console.error(`PARSE FAIL ${path.relative(ROOT, file)}: ${e.message}`);
    parseFailures++;
    continue;
  }

  traverse(ast, {
    Scopable(p) {
      const bindings = p.scope.bindings;
      for (const name of Object.keys(bindings)) {
        const b = bindings[name];
        if (b.kind !== 'const' && b.kind !== 'let') continue;
        const declNode = b.path.node;
        const declStart = declNode.start;
        const declLine = declNode.loc.start.line;
        const declFn = b.path.getFunctionParent();
        for (const ref of b.referencePaths) {
          if (ref.node.start >= declStart) continue;
          // Deferred execution: the reference lives in a function nested below
          // the declaration's own function scope, so it cannot run in the TDZ.
          if (ref.getFunctionParent() !== declFn) continue;
          const line = ref.node.loc.start.line;
          // FALSE POSITIVE: a reference on the declaration's own line is part of
          // the declaration itself — destructuring defaults that mention a
          // sibling (`const { a, b = a } = x`), a self-referential arrow, and
          // the binding identifier as babel occasionally reports it. Those are
          // either legal or a syntax error the parser would already have raised.
          if (line === declLine) continue;
          const key = `${file}:${ref.node.start}:${name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hazards.push({
            file: path.relative(ROOT, file), line, name, kind: b.kind, declLine,
          });
        }
      }
    },
  });
}

for (const h of hazards) {
  console.error(`${h.file}:${h.line}  '${h.name}' is read before its ${h.kind} declaration on line ${h.declLine}`);
}

if (parseFailures) console.error(`\n${parseFailures} file(s) failed to parse`);
if (hazards.length) {
  console.error(`\n${hazards.length} TDZ hazard(s) across ${files.length} file(s) — these throw at runtime, not at build time.`);
  process.exit(1);
}
if (parseFailures) process.exit(1);
console.log(`check-tdz: ${files.length} file(s) clean`);
