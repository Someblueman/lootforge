import { EnemyState, ArenaState, ProjectileState } from "../state";

export interface CombatStepResult {
  hitEffects: Array<{ x: number; y: number }>;
}

export class CombatSystem {
  private projectileCounter = 0;
  private readonly projectileSpeed = 520;
  private readonly projectileDamage = 45;
  private readonly projectileTtlMs = 900;
  private readonly fireCooldownMs = 140;
  private readonly contactDamagePerSecond = 14;

  tryFire(state: ArenaState, aimX: number, aimY: number): ProjectileState | null {
    if (state.mode !== "playing" || state.fireCooldownMs > 0) {
      return null;
    }

    const deltaX = aimX - state.player.x;
    const deltaY = aimY - state.player.y;
    const length = Math.hypot(deltaX, deltaY);
    if (length < 1) {
      return null;
    }

    const projectile: ProjectileState = {
      id: `p-${this.projectileCounter++}`,
      x: state.player.x,
      y: state.player.y,
      vx: (deltaX / length) * this.projectileSpeed,
      vy: (deltaY / length) * this.projectileSpeed,
      ttlMs: this.projectileTtlMs,
      radius: 7,
      damage: this.projectileDamage,
      visualId: "projectile.plasma_bolt",
    };

    state.fireCooldownMs = this.fireCooldownMs;
    state.projectiles.push(projectile);
    return projectile;
  }

  update(state: ArenaState, deltaMs: number): CombatStepResult {
    if (state.mode !== "playing") {
      return { hitEffects: [] };
    }

    const deltaSec = deltaMs / 1000;
    state.fireCooldownMs = Math.max(0, state.fireCooldownMs - deltaMs);

    for (const enemy of state.enemies) {
      const towardX = state.player.x - enemy.x;
      const towardY = state.player.y - enemy.y;
      const length = Math.hypot(towardX, towardY) || 1;
      enemy.x += (towardX / length) * enemy.speed * deltaSec;
      enemy.y += (towardY / length) * enemy.speed * deltaSec;
    }

    const liveProjectiles: ProjectileState[] = [];
    for (const projectile of state.projectiles) {
      projectile.x += projectile.vx * deltaSec;
      projectile.y += projectile.vy * deltaSec;
      projectile.ttlMs -= deltaMs;

      const inBounds =
        projectile.x >= -40 &&
        projectile.y >= -40 &&
        projectile.x <= state.world.width + 40 &&
        projectile.y <= state.world.height + 40;

      if (projectile.ttlMs > 0 && inBounds) {
        liveProjectiles.push(projectile);
      }
    }

    state.projectiles = liveProjectiles;

    const hitEffects: Array<{ x: number; y: number }> = [];
    const survivingProjectiles: ProjectileState[] = [];

    for (const projectile of state.projectiles) {
      let collided = false;

      for (const enemy of state.enemies) {
        const distance = Math.hypot(projectile.x - enemy.x, projectile.y - enemy.y);
        if (distance <= projectile.radius + enemy.radius) {
          enemy.hp -= projectile.damage;
          hitEffects.push({ x: enemy.x, y: enemy.y });
          collided = true;
          break;
        }
      }

      if (!collided) {
        survivingProjectiles.push(projectile);
      }
    }

    state.projectiles = survivingProjectiles;

    const aliveEnemies: EnemyState[] = [];
    for (const enemy of state.enemies) {
      if (enemy.hp <= 0) {
        state.kills += 1;
        state.score += enemy.scoreValue;
      } else {
        aliveEnemies.push(enemy);
      }
    }
    state.enemies = aliveEnemies;

    let totalContactDamage = 0;
    for (const enemy of state.enemies) {
      const distance = Math.hypot(enemy.x - state.player.x, enemy.y - state.player.y);
      if (distance <= enemy.radius + state.player.radius) {
        totalContactDamage += this.contactDamagePerSecond * deltaSec;
      }
    }

    if (totalContactDamage > 0) {
      state.player.hp = Math.max(0, state.player.hp - totalContactDamage);
      if (state.player.hp <= 0) {
        state.mode = "gameover";
      }
    }

    return { hitEffects };
  }
}
