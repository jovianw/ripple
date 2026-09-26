// t05: 12V -> ~3.0V divider (ratio 0.242-0.258), >=10k total.
import type { ExpectedChecks } from "../expected.ts"
export const expected: ExpectedChecks = {
  separate: [["header:12V", "header:ADC"]],
  dividers: [{ label: "12V to ADC divider", input: "header:12V", output: "header:ADC", ground: "header:GND", min_ratio: 2.9 / 12, max_ratio: 3.1 / 12, min_total_ohms: 10000 }],
}
