// Design tokens — single source of truth for the type and spacing scales used
// across the agent editor/builder surfaces. 4px-based spacing scale.

export const type = {
  micro: "11px", // micro-label / badge
  meta: "12px", // secondary / meta text
  body: "13px", // body
  emph: "14px", // emphasized body / button
  section: "16px", // section title
  page: "20px", // page title
  hero: "32px", // hero stat (overview %)
} as const;

export const space = {
  px: "1px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  6: "24px",
  8: "32px",
  10: "40px",
} as const;

/** Minimum touch target (px) — Apple HIG / Material. */
export const tap = 44;