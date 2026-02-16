import { describe, expect, test } from "vitest";

import { createInitialArenaState } from "../../examples/phaser-demo/src/game/state";
import { CombatSystem } from "../../examples/phaser-demo/src/game/systems/CombatSystem";
import { WaveSystem } from "../../examples/phaser-demo/src/game/systems/WaveSystem";
import { DEMO_ASSET_IDS } from "../../examples/phaser-demo/src/game/constants";

describe("phaser demo gameplay smoke", () => {
  test("player projectiles can defeat enemies and increment score", () => {
    const state = createInitialArenaState({ width: 960, height: 540 });
    const combat = new CombatSystem();

    state.enemies.push({
      id: "enemy-1",
      kind: DEMO_ASSET_IDS.enemyScrapRat,
      visualId: DEMO_ASSET_IDS.enemyScrapRat,
      x: state.player.x,
      y: state.player.y - 120,
      hp: 30,
      speed: 0,
      radius: 18,
      scoreValue: 12,
    });

    combat.tryFire(state, state.player.x, state.player.y - 200);

    for (let i = 0; i < 80; i += 1) {
      combat.update(state, 16.67);
    }

    expect(state.score).toBeGreaterThan(0);
    expect(state.enemies.length).toBe(0);
    expect(state.kills).toBe(1);
  });

  test("wave system spawns enemies after countdown", () => {
    const state = createInitialArenaState({ width: 960, height: 540 });
    const waveSystem = new WaveSystem(() => 0.25);

    const spawned = waveSystem.update(state, 800);

    expect(spawned.length).toBeGreaterThan(0);
    expect(state.wave).toBe(1);
    expect(state.enemies.length).toBe(spawned.length);
  });
});
