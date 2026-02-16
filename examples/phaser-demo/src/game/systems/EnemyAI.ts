import { DEMO_ASSET_IDS, TUNING, GAME_CONFIG } from "../constants";
import type { DungeonState, EnemyState, ProjectileState } from "../types";

export interface EnemyAIResult {
  spawnEnemies: EnemyState[];
  spawnProjectiles: ProjectileState[];
}

let enemyIdCounter = 0;
let projIdCounter = 0;

export class EnemyAI {
  update(state: DungeonState, deltaMs: number): EnemyAIResult {
    const result: EnemyAIResult = { spawnEnemies: [], spawnProjectiles: [] };

    if (state.mode !== "playing") return result;

    const deltaSec = deltaMs / 1000;
    const px = state.player.x;
    const py = state.player.y;

    for (const enemy of state.enemies) {
      switch (enemy.kind) {
        case "skeleton":
          this.updateSkeleton(enemy, px, py, deltaSec);
          break;
        case "slime":
          this.updateSlime(enemy, px, py, deltaSec);
          break;
        case "boss":
          this.updateBoss(enemy, state, deltaMs, deltaSec, result);
          break;
      }

      // Clamp enemies to room bounds
      enemy.x = clamp(enemy.x, enemy.radius, GAME_CONFIG.width - enemy.radius);
      enemy.y = clamp(enemy.y, enemy.radius, GAME_CONFIG.height - enemy.radius);
    }

    return result;
  }

  spawnSplitSlimes(deadEnemy: EnemyState): EnemyState[] {
    // Only split full-size slimes (radius >= TUNING threshold)
    if (
      deadEnemy.kind !== "slime" ||
      deadEnemy.radius < TUNING.enemy.slime.radius
    ) {
      return [];
    }

    const offsets = [
      { dx: -15, dy: 0 },
      { dx: 15, dy: 0 },
    ];

    return offsets.map((off) => ({
      id: `e-split-${enemyIdCounter++}`,
      kind: "slime" as const,
      x: deadEnemy.x + off.dx,
      y: deadEnemy.y + off.dy,
      hp: Math.ceil(deadEnemy.maxHp * 0.4),
      maxHp: Math.ceil(deadEnemy.maxHp * 0.4),
      speed: deadEnemy.speed * 1.2,
      radius: Math.ceil(deadEnemy.radius * 0.7),
      damage: Math.ceil(deadEnemy.damage * 0.6),
      scoreValue: Math.ceil(deadEnemy.scoreValue * 0.5),
      visualId: DEMO_ASSET_IDS.enemySlime,
      fireballCooldownMs: 0,
    }));
  }

  private updateSkeleton(
    enemy: EnemyState,
    px: number,
    py: number,
    deltaSec: number,
  ): void {
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    // Move toward player unless in contact range
    if (dist > enemy.radius + TUNING.player.radius + 4) {
      enemy.x += (dx / dist) * enemy.speed * deltaSec;
      enemy.y += (dy / dist) * enemy.speed * deltaSec;
    }
  }

  private updateSlime(
    enemy: EnemyState,
    px: number,
    py: number,
    deltaSec: number,
  ): void {
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    enemy.x += (dx / dist) * enemy.speed * deltaSec;
    enemy.y += (dy / dist) * enemy.speed * deltaSec;
  }

  private updateBoss(
    enemy: EnemyState,
    state: DungeonState,
    deltaMs: number,
    deltaSec: number,
    result: EnemyAIResult,
  ): void {
    const px = state.player.x;
    const py = state.player.y;
    const dx = px - enemy.x;
    const dy = py - enemy.y;
    const dist = Math.hypot(dx, dy) || 1;

    const hpRatio = enemy.hp / enemy.maxHp;
    const isPhase2 = hpRatio <= 0.5;

    // Circling behavior: maintain distance ~180px from player
    const desiredDist = isPhase2 ? 120 : 180;
    const speed = isPhase2 ? enemy.speed * 1.5 : enemy.speed;

    if (dist < desiredDist - 20) {
      // Back away
      enemy.x -= (dx / dist) * speed * deltaSec;
      enemy.y -= (dy / dist) * speed * deltaSec;
    } else if (dist > desiredDist + 40) {
      // Move closer
      enemy.x += (dx / dist) * speed * deltaSec;
      enemy.y += (dy / dist) * speed * deltaSec;
    } else {
      // Strafe (circle)
      const perpX = -dy / dist;
      const perpY = dx / dist;
      enemy.x += perpX * speed * deltaSec;
      enemy.y += perpY * speed * deltaSec;
    }

    // Fireballs
    enemy.fireballCooldownMs -= deltaMs;
    const cooldown = isPhase2
      ? TUNING.enemy.boss.fireballCooldownMs * 0.6
      : TUNING.enemy.boss.fireballCooldownMs;

    if (enemy.fireballCooldownMs <= 0) {
      enemy.fireballCooldownMs = cooldown;

      // Slight prediction: aim where player will be
      const predictionFactor = isPhase2 ? 0.3 : 0.15;
      const aimX = px + state.player.vx * predictionFactor;
      const aimY = py + state.player.vy * predictionFactor;
      const aDx = aimX - enemy.x;
      const aDy = aimY - enemy.y;
      const aDist = Math.hypot(aDx, aDy) || 1;

      result.spawnProjectiles.push({
        id: `fb-${projIdCounter++}`,
        x: enemy.x,
        y: enemy.y,
        vx: (aDx / aDist) * TUNING.enemy.boss.fireballSpeed,
        vy: (aDy / aDist) * TUNING.enemy.boss.fireballSpeed,
        ttlMs: TUNING.enemy.boss.fireballTtlMs,
        radius: TUNING.enemy.boss.fireballRadius,
        damage: TUNING.enemy.boss.fireballDamage,
        fromEnemy: true,
        visualId: DEMO_ASSET_IDS.projectileFireball,
      });
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
