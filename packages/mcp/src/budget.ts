/**
 * Every budget the agent door is held to, in one place. A task's budget is
 * its disk cost by rule; these are the sizes that rule cannot give. A
 * change may lower a standing ceiling. Raising one is a decision, recorded
 * in VAN-0002.
 */
export const BUDGET = {
  /** The most characters one read answers, across every address in the call. Past it the answer stops at a line and names the call that reads on. */
  readChars: 24_000,
  /** The most characters one outline answers. */
  outlineChars: 8_000,
  /** The most lines one find answers, and the most characters of one of them. */
  findLines: 40,
  findLineChars: 240,
  /** What one hub call may cost above the same task on a disk: the address and the answer line. */
  addressAllowance: 100,
  /** What an agent holds before it works. */
  standing: {
    /** The tool list a hub sends by default, as JSON. Measured 7,351 at the first release of the small core. */
    coreTools: 7_500,
    /** The same on a laptop, where the bridge adds paths, checkout, and sync. Measured 9,153. */
    laptopTools: 9_500,
    /** The connect instructions. Measured 878 on a hub and 1,114 on a laptop. */
    instructions: 1_200,
    /** The first paragraph of the instructions. Codex asks that the first 512 characters stand alone. */
    instructionsLead: 512,
    /** The descriptions of every skill the plugin ships. Measured 1,962. */
    skillDescriptions: 2_000,
  },
} as const;
