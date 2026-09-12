// Maps the `icon` keys returned by /api/gamification/achievements (and
// /achievements/check) to an emoji. Keep in sync with ACHIEVEMENTS in
// leettrack_backend/app/services/gamification.py — unrecognized keys
// just fall back to a trophy, so a mismatch here never breaks the UI,
// it just looks a little less specific.
export const ACHIEVEMENT_ICONS: Record<string, string> = {
  seedling: "🌱",
  sprout: "🌿",
  flame: "🔥",
  star: "⭐",
  crown: "👑",
  sunrise: "🌅",
  bolt: "⚡",
  rocket: "🚀",
  medal_silver: "🥈",
  medal_gold: "🥇",
  mountain: "🏔️",
  sword: "🗡️",
  swords: "⚔️",
  owl: "🦉",
  bird: "🐦",
  beach: "🏖️",
  link: "🔗",
};

export function achievementIcon(icon: string): string {
  return ACHIEVEMENT_ICONS[icon] ?? "🏆";
}
