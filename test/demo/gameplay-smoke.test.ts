import { describe, expect, test } from "vitest";

import { createInitialDungeonState } from "../../examples/phaser-demo/src/game/state";
import { CombatSystem } from "../../examples/phaser-demo/src/game/systems/CombatSystem";
import { PickupSystem } from "../../examples/phaser-demo/src/game/systems/PickupSystem";
import {
  DEMO_ASSET_IDS,
  TUNING,
} from "../../examples/phaser-demo/src/game/constants";

describe("phaser demo gameplay smoke", () => {
  test("player melee can damage enemies", () => {
    const state = createInitialDungeonState();
    const combat = new CombatSystem();

    // Place skeleton directly in front of the player (right of center)
    state.player.facingAngle = 0; // facing right
    state.enemies.push({
      id: "skel-1",
      kind: "skeleton",
      x: state.player.x + 40,
      y: state.player.y,
      hp: TUNING.enemy.skeleton.hp,
      maxHp: TUNING.enemy.skeleton.hp,
      speed: 0,
      radius: TUNING.enemy.skeleton.radius,
      damage: TUNING.enemy.skeleton.damage,
      scoreValue: TUNING.enemy.skeleton.scoreValue,
      visualId: DEMO_ASSET_IDS.enemySkeleton,
      fireballCooldownMs: 0,
    });

    const result = combat.meleeAttack(state);
    expect(result.hitEffects.length).toBeGreaterThan(0);
    expect(state.enemies[0].hp).toBeLessThan(TUNING.enemy.skeleton.hp);
  });

  test("player bolt projectile can hit and kill enemies", () => {
    const state = createInitialDungeonState();
    const combat = new CombatSystem();

    state.enemies.push({
      id: "slime-1",
      kind: "slime",
      x: state.player.x,
      y: state.player.y - 120,
      hp: 10, // Low HP to guarantee kill
      maxHp: TUNING.enemy.slime.hp,
      speed: 0,
      radius: TUNING.enemy.slime.radius,
      damage: TUNING.enemy.slime.damage,
      scoreValue: TUNING.enemy.slime.scoreValue,
      visualId: DEMO_ASSET_IDS.enemySlime,
      fireballCooldownMs: 0,
    });

    combat.fireBolt(state, state.player.x, state.player.y - 200);

    for (let i = 0; i < 80; i++) {
      combat.update(state, 16.67);
    }

    expect(state.score).toBeGreaterThan(0);
    expect(state.enemies.length).toBe(0);
    expect(state.kills).toBe(1);
  });

  test("collecting key adds to inventory", () => {
    const state = createInitialDungeonState();
    const pickupSystem = new PickupSystem();

    // Place key at player position
    state.pickups.push({
      id: "key-1",
      kind: "key",
      x: state.player.x,
      y: state.player.y,
      radius: TUNING.pickup.pickupRadius,
      visualId: DEMO_ASSET_IDS.pickupKey,
    });

    expect(state.inventory.keys).toBe(0);
    const result = pickupSystem.update(state);
    expect(state.inventory.keys).toBe(1);
    expect(result.collected.length).toBe(1);
    expect(result.collected[0].kind).toBe("key");
  });

  test("boss defeat sets bossDefeated flag", () => {
    const state = createInitialDungeonState();
    const combat = new CombatSystem();

    state.enemies.push({
      id: "boss-1",
      kind: "boss",
      x: state.player.x,
      y: state.player.y - 120,
      hp: 1, // Nearly dead
      maxHp: TUNING.enemy.boss.hp,
      speed: 0,
      radius: TUNING.enemy.boss.radius,
      damage: TUNING.enemy.boss.damage,
      scoreValue: TUNING.enemy.boss.scoreValue,
      visualId: DEMO_ASSET_IDS.bossEmberKing,
      fireballCooldownMs: 99999, // Prevent fireballs
    });

    combat.fireBolt(state, state.player.x, state.player.y - 200);

    for (let i = 0; i < 80; i++) {
      combat.update(state, 16.67);
    }

    expect(state.bossDefeated).toBe(true);
    expect(state.enemies.length).toBe(0);
  });
});
