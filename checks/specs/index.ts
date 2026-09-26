// Registry of expected checks per spec id. Add one file per spec and register it here.
import type { ExpectedChecks } from "../expected.ts"
import { expected as ledBoard } from "./led-board.ts"

const registry: Record<string, ExpectedChecks> = {
  "led-board": ledBoard,
}

export function loadExpected(specId: string): ExpectedChecks {
  const e = registry[specId]
  if (!e) throw new Error(`no expected checks for spec "${specId}" (known: ${Object.keys(registry).join(", ")})`)
  return e
}

export const knownSpecIds = () => Object.keys(registry)
