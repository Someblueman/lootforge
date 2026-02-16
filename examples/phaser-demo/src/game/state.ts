import { DEMO_ASSET_IDS } from "./constants";

export type GameMode = "playing" | "gameover";

export interface VectorLike {
  x: number;
  y: number;
}

export interface WorldBounds {
  width: number;
  height: number;
}

export interface PlayerState extends VectorLike {
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  visualId: string;
}

export interface EnemyState extends VectorLike {
  id: string;
  kind: string;
  visualId: string;
  hp: number;
  speed: number;
  radius: number;
  scoreValue: number;
}

export interface ProjectileState extends VectorLike {
  id: string;
  vx: number;
  vy: number;
  ttlMs: number;
  radius: number;
  damage: number;
  visualId: string;
}

export interface ArenaState {
  mode: GameMode;
  coordinateSystem: string;
  world: WorldBounds;
  elapsedMs: number;
  player: PlayerState;
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  score: number;
  kills: number;
  wave: number;
  waveCountdownMs: number;
  fireCooldownMs: number;
}

export function createInitialArenaState(world: WorldBounds): ArenaState {
  return {
    mode: "playing",
    coordinateSystem: "origin top-left, +x right, +y down",
    world,
    elapsedMs: 0,
    player: {
      x: world.width / 2,
      y: world.height / 2,
      vx: 0,
      vy: 0,
      hp: 120,
      maxHp: 120,
      speed: 260,
      radius: 20,
      visualId: DEMO_ASSET_IDS.player,
    },
    enemies: [],
    projectiles: [],
    score: 0,
    kills: 0,
    wave: 0,
    waveCountdownMs: 600,
    fireCooldownMs: 0,
  };
}
