// ── Shared type definitions for Crypt of the Ember King ──

export type RoomId = "crypt_entrance" | "treasure_hall" | "throne_room";

export type EnemyKind = "skeleton" | "slime" | "boss";

export type PickupKind = "health_potion" | "key" | "gold";

export type DoorState = "locked" | "unlocked" | "open";

export type GameMode = "playing" | "gameover" | "victory" | "room_transition";

// ── Entity state interfaces ──

export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  facingAngle: number;
  meleeCooldownMs: number;
  boltCooldownMs: number;
  invulnerabilityMs: number;
  visualId: string;
}

export interface EnemyState {
  id: string;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damage: number;
  scoreValue: number;
  visualId: string;
  // Boss-specific
  fireballCooldownMs: number;
}

export interface ProjectileState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttlMs: number;
  radius: number;
  damage: number;
  fromEnemy: boolean;
  visualId: string;
}

export interface PickupState {
  id: string;
  kind: PickupKind;
  x: number;
  y: number;
  radius: number;
  visualId: string;
}

export interface DoorEntity {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targetRoom: RoomId;
  state: DoorState;
  requiresKey: boolean;
}

export interface Inventory {
  keys: number;
  gold: number;
}

// ── Room config ──

export interface RoomConfig {
  id: RoomId;
  backgroundAssetId: string;
  enemies: Array<{ kind: EnemyKind; x: number; y: number }>;
  pickups: Array<{ kind: PickupKind; x: number; y: number }>;
  doors: Array<Omit<DoorEntity, "id" | "state"> & { startsLocked: boolean }>;
  playerSpawn: { x: number; y: number };
  isBossRoom: boolean;
}

// ── Top-level game state ──

export interface DungeonState {
  mode: GameMode;
  currentRoom: RoomId;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  pickups: PickupState[];
  doors: DoorEntity[];
  inventory: Inventory;
  roomsCleared: Set<RoomId>;
  score: number;
  kills: number;
  elapsedMs: number;
  bossDefeated: boolean;
}

// ── Combat result ──

export interface CombatStepResult {
  hitEffects: Array<{
    x: number;
    y: number;
    type: "slash" | "bolt" | "fireball";
  }>;
  killedEnemyIds: string[];
  killedEnemies: EnemyState[];
  playerDamaged: boolean;
}
