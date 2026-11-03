import type { RolloutType } from './flag-key.js';

/** Who gets the flag: rolloutValue % of users (PERCENT) or the first rolloutValue users (COUNT). */
export type Rollout = {
  rolloutType: RolloutType;
  rolloutValue: number;
};

/** One targeting rule: users whose `attribute` equals `value` get this rule's rollout instead of the flag's. */
export type FlagRule = Rollout & {
  attribute: string;
  value: string;
};
