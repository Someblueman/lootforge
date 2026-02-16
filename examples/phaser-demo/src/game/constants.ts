export const DEMO_ASSET_IDS = {
  arenaBackground: "arena.background.scrapyard",
  player: "player.scavenger",
  enemyScrapRat: "enemy.scrap_rat",
  enemyRustDrone: "enemy.rust_drone",
  projectile: "projectile.plasma_bolt",
  hitEffect: "effect.hit_spark",
  uiHealth: "ui.icon.health",
  uiScore: "ui.icon.score",
  uiWave: "ui.icon.wave",
} as const;

export const REQUIRED_ASSET_IDS = Object.values(DEMO_ASSET_IDS);

export const GAME_CONFIG = {
  width: 960,
  height: 540,
} as const;
