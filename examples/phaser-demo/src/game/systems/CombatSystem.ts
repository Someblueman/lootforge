import { DEMO_ASSET_IDS, TUNING, GAME_CONFIG } from "../constants";
import type {
  DungeonState,
  EnemyState,
  ProjectileState,
  CombatStepResult,
} from "../types";

export type { CombatStepResult };

export class CombatSystem {
  private projectileCounter = 0;

  fireBolt(state: DungeonState, aimX: number, aimY: number): boolean {
    if (state.mode !== "playing" || state.player.boltCooldownMs > 0) {
      return false;
    }

    const dx = aimX - state.player.x;
    const dy = aimY - state.player.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return false;

    const projectile: ProjectileState = {
      id: `pb-${this.projectileCounter++}`,
      x: state.player.x,
      y: state.player.y,
      vx: (dx / len) * TUNING.player.boltSpeed,
      vy: (dy / len) * TUNING.player.boltSpeed,
      ttlMs: TUNING.player.boltTtlMs,
      radius: TUNING.player.boltRadius,
      damage: TUNING.player.boltDamage,
      fromEnemy: false,
      visualId: DEMO_ASSET_IDS.projectileMagicBolt,
    };

    state.player.boltCooldownMs = TUNING.player.boltCooldownMs;
    state.projectiles.push(projectile);
    return true;
  }

  meleeAttack(state: DungeonState): CombatStepResult {
    const result: CombatStepResult = {
      hitEffects: [],
      killedEnemyIds: [],
      killedEnemies: [],
      playerDamaged: false,
    };

    if (state.mode !== "playing" || state.player.meleeCooldownMs > 0) {
      return result;
    }

    state.player.meleeCooldownMs = TUNING.player.meleeCooldownMs;

    const { meleeRange, meleeArc, meleeDamage } = TUNING.player;
    const facing = state.player.facingAngle;
    const halfArc = meleeArc / 2;

    for (const enemy of state.enemies) {
      const dx = enemy.x - state.player.x;
      const dy = enemy.y - state.player.y;
      const dist = Math.hypot(dx, dy);

      if (dist > meleeRange + enemy.radius) continue;

      const angleToEnemy = Math.atan2(dy, dx);
      const angleDiff = normalizeAngle(angleToEnemy - facing);

      if (Math.abs(angleDiff) > halfArc) continue;

      enemy.hp -= meleeDamage;
      result.hitEffects.push({ x: enemy.x, y: enemy.y, type: "slash" });

      // Knockback
      if (dist > 0) {
        const knockbackDist = 30;
        enemy.x += (dx / dist) * knockbackDist;
        enemy.y += (dy / dist) * knockbackDist;
      }
    }

    return result;
  }

  update(state: DungeonState, deltaMs: number): CombatStepResult {
    const result: CombatStepResult = {
      hitEffects: [],
      killedEnemyIds: [],
      killedEnemies: [],
      playerDamaged: false,
    };

    if (state.mode !== "playing") return result;

    const deltaSec = deltaMs / 1000;

    // Tick cooldowns
    state.player.meleeCooldownMs = Math.max(
      0,
      state.player.meleeCooldownMs - deltaMs,
    );
    state.player.boltCooldownMs = Math.max(
      0,
      state.player.boltCooldownMs - deltaMs,
    );
    state.player.invulnerabilityMs = Math.max(
      0,
      state.player.invulnerabilityMs - deltaMs,
    );

    // Move all projectiles
    const liveProjectiles: ProjectileState[] = [];
    for (const proj of state.projectiles) {
      proj.x += proj.vx * deltaSec;
      proj.y += proj.vy * deltaSec;
      proj.ttlMs -= deltaMs;

      const inBounds =
        proj.x >= -40 &&
        proj.y >= -40 &&
        proj.x <= GAME_CONFIG.width + 40 &&
        proj.y <= GAME_CONFIG.height + 40;

      if (proj.ttlMs > 0 && inBounds) {
        liveProjectiles.push(proj);
      }
    }
    state.projectiles = liveProjectiles;

    // Player projectiles vs enemies
    const surviving: ProjectileState[] = [];
    for (const proj of state.projectiles) {
      if (proj.fromEnemy) {
        surviving.push(proj);
        continue;
      }

      let hit = false;
      for (const enemy of state.enemies) {
        const dist = Math.hypot(proj.x - enemy.x, proj.y - enemy.y);
        if (dist <= proj.radius + enemy.radius) {
          enemy.hp -= proj.damage;
          result.hitEffects.push({ x: enemy.x, y: enemy.y, type: "bolt" });
          hit = true;
          break;
        }
      }

      if (!hit) surviving.push(proj);
    }

    // Enemy projectiles vs player
    const stillFlying: ProjectileState[] = [];
    for (const proj of surviving) {
      if (!proj.fromEnemy) {
        stillFlying.push(proj);
        continue;
      }

      const dist = Math.hypot(proj.x - state.player.x, proj.y - state.player.y);
      if (
        dist <= proj.radius + state.player.radius &&
        state.player.invulnerabilityMs <= 0
      ) {
        state.player.hp -= proj.damage;
        state.player.invulnerabilityMs = TUNING.player.invulnerabilityMs;
        result.playerDamaged = true;
        result.hitEffects.push({
          x: state.player.x,
          y: state.player.y,
          type: "fireball",
        });
      } else {
        stillFlying.push(proj);
      }
    }
    state.projectiles = stillFlying;

    // Remove dead enemies
    const alive: EnemyState[] = [];
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) {
        state.kills += 1;
        state.score += enemy.scoreValue;
        result.killedEnemyIds.push(enemy.id);
        result.killedEnemies.push(enemy);
        if (enemy.kind === "boss") {
          state.bossDefeated = true;
        }
      } else {
        alive.push(enemy);
      }
    }
    state.enemies = alive;

    // Contact damage
    if (state.player.invulnerabilityMs <= 0) {
      let contactDmg = 0;
      for (const enemy of state.enemies) {
        const dist = Math.hypot(
          enemy.x - state.player.x,
          enemy.y - state.player.y,
        );
        if (dist <= enemy.radius + state.player.radius) {
          contactDmg += enemy.damage * deltaSec;
        }
      }

      if (contactDmg > 0) {
        state.player.hp = Math.max(0, state.player.hp - contactDmg);
        result.playerDamaged = true;
      }
    }

    // Player death
    if (state.player.hp <= 0) {
      state.mode = "gameover";
    }

    return result;
  }
}

function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
