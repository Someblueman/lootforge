import { TUNING } from "../constants";
import type { DungeonState, PickupKind } from "../types";

export interface PickupEvent {
  kind: PickupKind;
  x: number;
  y: number;
}

export interface PickupSystemResult {
  collected: PickupEvent[];
}

export class PickupSystem {
  update(state: DungeonState): PickupSystemResult {
    const result: PickupSystemResult = { collected: [] };

    if (state.mode !== "playing") return result;

    const collectRange = TUNING.pickup.pickupRadius + state.player.radius;

    state.pickups = state.pickups.filter((pickup) => {
      const dist = Math.hypot(
        pickup.x - state.player.x,
        pickup.y - state.player.y,
      );

      if (dist > collectRange) return true;

      // Apply effect
      switch (pickup.kind) {
        case "health_potion":
          state.player.hp = Math.min(
            state.player.maxHp,
            state.player.hp + TUNING.pickup.healthPotionHeal,
          );
          break;
        case "key":
          state.inventory.keys += 1;
          break;
        case "gold":
          state.inventory.gold += TUNING.pickup.goldValue;
          state.score += TUNING.pickup.goldValue;
          break;
      }

      result.collected.push({ kind: pickup.kind, x: pickup.x, y: pickup.y });
      return false;
    });

    return result;
  }
}
