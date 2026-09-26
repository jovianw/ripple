// Props for a whitelisted part, by id. Reference boards use only whitelisted parts.
import whitelist from "../../parts/whitelist.json" with { type: "json" }

export function part(id: string): Record<string, unknown> {
  const p = whitelist.parts.find((p) => p.id === id)
  if (!p) throw new Error(`part ${id} is not in parts/whitelist.json`)
  return p.props as Record<string, unknown>
}
