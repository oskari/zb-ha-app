# @zb/expressions

Shared expression engine for the `zb_engine` server and the widget builder.

This package is the single source of truth for the JSON expression language
described in `BUILDER_API.md` and `DOCS.md`. Both the server's render
pipeline and the builder's canvas preview consume this package so that
`{{path|round|format:1}}` evaluates the same way in both environments.

## Surface

```ts
import {
  resolveValue,        // recursive bindings/expressions resolver
  evaluate,            // alias for resolveValue (builder-style)
  evaluateExpression,  // single expression-object evaluator
  resolvePath,         // dot-path lookup against a DataContext
  createDataContext,   // null-prototype empty context
  validateContextKey,  // is a string a safe context-root key?
  RESERVED_CONTEXT_ROOTS,
  isBinding, isExpression, getExpressionOp,
  buildPipeExpression, composePipeSyntax,
  BLOCKED_KEYS, MAX_RESOLVE_DEPTH,
} from "@zb/expressions";
```

## Build

```sh
npm run build       # builds both CJS (dist/cjs) and ESM (dist/esm)
npm test            # runs the cross-engine parity vector test
```
