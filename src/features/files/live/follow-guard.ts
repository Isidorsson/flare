import { LIVE } from "./timing";

/** When the user last took the editor into their own hands. */
export interface UserActivity {
  typedAt: number | null;
  pickedAt: number | null;
}

export const NO_USER_ACTIVITY: UserActivity = { typedAt: null, pickedAt: null };

function within(at: number | null, now: number, windowMs: number): boolean {
  return at !== null && now - at < windowMs;
}

/** Whether the user typed so recently that the editor must not go read-only under their hands. */
export function userIsTyping(activity: UserActivity, now: number): boolean {
  return within(activity.typedAt, now, LIVE.follow.typedGraceMs);
}

/** Whether the user typed or picked a file recently enough that following the agent must not move the editor. */
export function userHoldsEditor(activity: UserActivity, now: number): boolean {
  return userIsTyping(activity, now) || within(activity.pickedAt, now, LIVE.follow.pickedGraceMs);
}
