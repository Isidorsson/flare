/** Nominal distance between neighbouring files in layout units; every other layout size is a multiple of it. */
export const SEED_SPACING = 4;

export const RELAX_ROUNDS = 36;
export const SETTLE_ROUNDS = 14;
export const RELAX_PULL = 0.22;
export const SEPARATION_PASSES_PER_ROUND = 2;
export const FINAL_SEPARATION_PASSES = 160;

/** Collision radii as a share of SEED_SPACING: files just fit side by side, hubs claim room for their label. */
export const FILE_RADIUS_SHARE = 0.47;
export const HUB_RADIUS_SHARE = 1.25;
