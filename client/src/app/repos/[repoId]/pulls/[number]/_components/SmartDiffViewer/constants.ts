import type { Severity, SmartDiffRole } from "@devdigest/shared";
import type { IconName } from "@devdigest/ui";

/** Fixed core → wiring → boilerplate order — mirrors the server's group
    order (the server already omits empty groups; this only drives lookups
    like icon/colour/label maps keyed by role). */
export const ROLE_ORDER: SmartDiffRole[] = ["core", "wiring", "boilerplate"];

/** Left-edge accent colour per role, distinct from severity colours (used on
    a finding's own diff line) so the two signals never collide visually. */
export const ROLE_COLOR_VAR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  boilerplate: "var(--text-muted)",
};

/** i18n key for each role's one-line description under its group header. */
export const ROLE_DESC_KEY: Record<SmartDiffRole, "coreDesc" | "wiringDesc" | "boilerplateDesc"> = {
  core: "coreDesc",
  wiring: "wiringDesc",
  boilerplate: "boilerplateDesc",
};

/** i18n key for each role's plain label (Core / Wiring / Boilerplate). */
export const ROLE_LABEL_KEY: Record<SmartDiffRole, "coreLabel" | "wiringLabel" | "boilerplateLabel"> = {
  core: "coreLabel",
  wiring: "wiringLabel",
  boilerplate: "boilerplateLabel",
};

/** Icon per role, reusing the app-wide icon registry — no new icons added. */
export const ROLE_ICON: Record<SmartDiffRole, IconName> = {
  core: "Code",
  wiring: "Wrench",
  boilerplate: "Boxes",
};

/** How long a jumped-to line stays highlighted before fading back. */
export const HIGHLIGHT_MS = 1200;

/** Line-badge label per severity — deliberately not `SEV[severity].label`
    (that's "Critical"/"Warning"/"Suggestion", used everywhere else). The
    design for this one spot renames CRITICAL to "blocker" and lowercases all
    three, so it stays local to Smart Diff rather than changing the shared
    vendor token every other severity badge in the app reads from. */
export const LINE_BADGE_LABEL: Record<Severity, string> = {
  CRITICAL: "blocker",
  WARNING: "warning",
  SUGGESTION: "suggestion",
};
