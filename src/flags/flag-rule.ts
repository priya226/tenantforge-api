/** One targeting rule: users whose `attribute` equals `value` get `percent` instead of the default. */
export interface FlagRule {
  attribute: string;
  value: string;
  percent: number;
}
