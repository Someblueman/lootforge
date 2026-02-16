// ── Asset identifiers (must match manifest.dungeon.json target IDs) ──

export const DEMO_ASSET_IDS = {
  // Rooms
  roomCryptEntrance: "room.crypt_entrance",
  roomTreasureHall: "room.treasure_hall",
  roomThroneRoom: "room.throne_room",
  // Characters
  player: "player.knight",
  enemySkeleton: "enemy.skeleton",
  enemySlime: "enemy.slime",
  bossEmberKing: "boss.ember_king",
  // Projectiles & Effects
  projectileMagicBolt: "projectile.magic_bolt",
  projectileFireball: "projectile.fireball",
  effectHitSlash: "effect.hit_slash",
  effectDeathBurst: "effect.death_burst",
  // Pickups
  pickupHealthPotion: "pickup.health_potion",
  pickupKey: "pickup.key",
  pickupGold: "pickup.gold",
  // UI Icons
  uiHealth: "ui.icon.health",
  uiAttack: "ui.icon.attack",
  uiKey: "ui.icon.key",
  uiGold: "ui.icon.gold",
} as const;

export const REQUIRED_ASSET_IDS = Object.values(DEMO_ASSET_IDS);

// ── Game config ──

export const GAME_CONFIG = {
  width: 960,
  height: 540,
} as const;

// ── Depth layers ──

export const DEPTH = {
  background: 0,
  shadows: 2,
  pickups: 4,
  enemies: 8,
  player: 10,
  projectiles: 12,
  effects: 14,
  hud: 20,
  overlay: 25,
} as const;

// ── Tuning constants ──

export const TUNING = {
  player: {
    maxHp: 100,
    speed: 200,
    radius: 16,
    meleeRange: 60,
    meleeArc: Math.PI / 2, // 90 degrees
    meleeDamage: 30,
    meleeCooldownMs: 400,
    boltSpeed: 480,
    boltDamage: 20,
    boltTtlMs: 1000,
    boltCooldownMs: 250,
    boltRadius: 6,
    invulnerabilityMs: 500,
  },
  enemy: {
    skeleton: {
      hp: 60,
      speed: 80,
      radius: 14,
      damage: 12,
      scoreValue: 15,
    },
    slime: {
      hp: 40,
      speed: 55,
      radius: 12,
      damage: 8,
      scoreValue: 10,
    },
    boss: {
      hp: 400,
      speed: 45,
      radius: 28,
      damage: 20,
      scoreValue: 100,
      fireballCooldownMs: 1800,
      fireballSpeed: 300,
      fireballDamage: 25,
      fireballRadius: 10,
      fireballTtlMs: 2000,
    },
  },
  pickup: {
    healthPotionHeal: 30,
    goldValue: 25,
    pickupRadius: 18,
  },
  room: {
    transitionMs: 400,
  },
} as const;
