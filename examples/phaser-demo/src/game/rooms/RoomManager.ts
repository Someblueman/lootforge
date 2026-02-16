import { DEMO_ASSET_IDS, TUNING } from "../constants";
import type {
  DungeonState,
  RoomId,
  EnemyState,
  PickupState,
  DoorEntity,
  EnemyKind,
} from "../types";
import { ROOM_CONFIGS } from "./RoomData";

let entityCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${entityCounter++}`;
}

function makeEnemy(kind: EnemyKind, x: number, y: number): EnemyState {
  const stats = kind === "boss" ? TUNING.enemy.boss : TUNING.enemy[kind];
  return {
    id: nextId("e"),
    kind,
    x,
    y,
    hp: stats.hp,
    maxHp: stats.hp,
    speed: stats.speed,
    radius: stats.radius,
    damage: stats.damage,
    scoreValue: stats.scoreValue,
    visualId:
      kind === "skeleton"
        ? DEMO_ASSET_IDS.enemySkeleton
        : kind === "slime"
          ? DEMO_ASSET_IDS.enemySlime
          : DEMO_ASSET_IDS.bossEmberKing,
    fireballCooldownMs:
      kind === "boss" ? TUNING.enemy.boss.fireballCooldownMs : 0,
  };
}

function makePickup(
  kind: PickupState["kind"],
  x: number,
  y: number,
): PickupState {
  return {
    id: nextId("pk"),
    kind,
    x,
    y,
    radius: TUNING.pickup.pickupRadius,
    visualId:
      kind === "health_potion"
        ? DEMO_ASSET_IDS.pickupHealthPotion
        : kind === "key"
          ? DEMO_ASSET_IDS.pickupKey
          : DEMO_ASSET_IDS.pickupGold,
  };
}

function makeDoor(
  cfg: (typeof ROOM_CONFIGS)[string]["doors"][number],
  index: number,
): DoorEntity {
  return {
    id: nextId(`door-${index}`),
    x: cfg.x,
    y: cfg.y,
    width: cfg.width,
    height: cfg.height,
    targetRoom: cfg.targetRoom,
    state: cfg.startsLocked ? "locked" : "unlocked",
    requiresKey: cfg.requiresKey,
  };
}

export class RoomManager {
  loadRoom(state: DungeonState, roomId: RoomId): void {
    const config = ROOM_CONFIGS[roomId];
    if (!config) {
      throw new Error(`Unknown room: ${roomId}`);
    }

    state.currentRoom = roomId;
    state.enemies = config.enemies.map((e) => makeEnemy(e.kind, e.x, e.y));
    state.pickups = config.pickups.map((p) => makePickup(p.kind, p.x, p.y));
    state.doors = config.doors.map((d, i) => makeDoor(d, i));
    state.projectiles = [];

    state.player.x = config.playerSpawn.x;
    state.player.y = config.playerSpawn.y;
    state.player.vx = 0;
    state.player.vy = 0;
  }

  beginTransition(state: DungeonState, targetRoom: RoomId): void {
    state.mode = "room_transition";
    // GameScene will handle the visual fade, then call completeTransition
    (state as DungeonState & { _pendingRoom?: RoomId })._pendingRoom =
      targetRoom;
  }

  completeTransition(state: DungeonState): void {
    const pending = (state as DungeonState & { _pendingRoom?: RoomId })
      ._pendingRoom;
    if (!pending) return;

    state.roomsCleared.add(state.currentRoom);
    this.loadRoom(state, pending);
    state.mode = "playing";
    delete (state as DungeonState & { _pendingRoom?: RoomId })._pendingRoom;
  }

  checkRoomCleared(state: DungeonState): boolean {
    return state.enemies.length === 0;
  }

  checkBossDefeated(state: DungeonState): boolean {
    const config = ROOM_CONFIGS[state.currentRoom];
    if (!config?.isBossRoom) return false;
    return state.enemies.length === 0 && !state.bossDefeated;
  }

  getRoomConfig(roomId: RoomId) {
    return ROOM_CONFIGS[roomId];
  }
}
