// Renders a tscircuit board component to Circuit JSON (autorouted). Test helper only.
import { RootCircuit } from "tscircuit"
import type { AnyCircuitElement } from "circuit-json"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renderBoard(Board: () => any): Promise<AnyCircuitElement[]> {
  const circuit = new RootCircuit()
  circuit.add(<Board />)
  await circuit.renderUntilSettled()
  return circuit.getCircuitJson() as AnyCircuitElement[]
}
