import { DEMO_ASSET_IDS } from "../constants";
import { ArenaState, EnemyState } from "../state";

export class WaveSystem {
  private enemyCounter = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  update(state: ArenaState, deltaMs: number): EnemyState[] {
    if (state.mode !== "playing") {
      return [];
    }

    if (state.enemies.length > 0) {
      return [];
    }

    state.waveCountdownMs -= deltaMs;
    if (state.waveCountdownMs > 0) {
      return [];
    }

    state.wave += 1;
    state.waveCountdownMs = 2200;

    const spawnCount = Math.min(2 + state.wave, 12);
    const spawned: EnemyState[] = [];

    for (let index = 0; index < spawnCount; index += 1) {
      const useRat = (index + state.wave) % 2 === 0;
      const kind = useRat ? DEMO_ASSET_IDS.enemyScrapRat : DEMO_ASSET_IDS.enemyRustDrone;
      const baseHp = useRat ? 60 : 84;
      const hp = baseHp + state.wave * 6;
      const speed = useRat ? 86 + state.wave * 2.5 : 64 + state.wave * 2;
      const radius = useRat ? 18 : 24;

      const side = Math.floor(this.rng() * 4);
      const maxX = state.world.width;
      const maxY = state.world.height;
      let x = 0;
      let y = 0;

      if (side === 0) {
        x = this.rng() * maxX;
        y = -30;
      } else if (side === 1) {
        x = maxX + 30;
        y = this.rng() * maxY;
      } else if (side === 2) {
        x = this.rng() * maxX;
        y = maxY + 30;
      } else {
        x = -30;
        y = this.rng() * maxY;
      }

      spawned.push({
        id: `e-${this.enemyCounter++}`,
        kind,
        visualId: kind,
        x,
        y,
        hp,
        speed,
        radius,
        scoreValue: useRat ? 12 : 18,
      });
    }

    state.enemies.push(...spawned);
    return spawned;
  }
}
