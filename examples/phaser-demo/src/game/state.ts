import { DEMO_ASSET_IDS, GAME_CONFIG, TUNING } from "./constants";
import type { DungeonState, PlayerState, Inventory, RoomId } from "./types";

export type { DungeonState };

export interface WorldBounds {
  width: number;
  height: number;
}

function createInitialPlayer(spawnX: number, spawnY: number): PlayerState {
  return {
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    hp: TUNING.player.maxHp,
    maxHp: TUNING.player.maxHp,
    speed: TUNING.player.speed,
    radius: TUNING.player.radius,
    facingAngle: 0,
    meleeCooldownMs: 0,
    boltCooldownMs: 0,
    invulnerabilityMs: 0,
    visualId: DEMO_ASSET_IDS.player,
  };
}

function createInitialInventory(): Inventory {
  return {
    keys: 0,
    gold: 0,
  };
}

export function createInitialDungeonState(
  world: WorldBounds = { width: GAME_CONFIG.width, height: GAME_CONFIG.height },
  startRoom: RoomId = "crypt_entrance",
): DungeonState {
  return {
    mode: "playing",
    currentRoom: startRoom,
    player: createInitialPlayer(world.width / 2, world.height / 2),
    enemies: [],
    projectiles: [],
    pickups: [],
    doors: [],
    inventory: createInitialInventory(),
    roomsCleared: new Set<RoomId>(),
    score: 0,
    kills: 0,
    elapsedMs: 0,
    bossDefeated: false,
  };
}
