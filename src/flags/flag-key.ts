/** Allowed flag keys; must match ck_feature_flag_key in V5. */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

export const MAX_RULES = 50;

/** PERCENT: rolloutValue % of users. COUNT: the first rolloutValue users. */
export const ROLLOUT_TYPES = ['PERCENT', 'COUNT'] as const;
export type RolloutType = (typeof ROLLOUT_TYPES)[number];

/** Largest COUNT rollout; must match ck_feature_flag_rollout in V5. */
export const MAX_ROLLOUT_COUNT = 10_000;
