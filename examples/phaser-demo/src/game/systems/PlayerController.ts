import { TUNING, GAME_CONFIG } from "../constants";
import type { DungeonState, DoorEntity } from "../types";

export interface PlayerInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  mouseX: number;
  mouseY: number;
  mouseDown: boolean;
  interactPressed: boolean;
}

export interface PlayerControllerResult {
  meleeAttack: boolean;
  boltFired: boolean;
  interactedDoor: DoorEntity | null;
}

export class PlayerController {
  update(
    state: DungeonState,
    deltaMs: number,
    input: PlayerInput,
  ): PlayerControllerResult {
    const result: PlayerControllerResult = {
      meleeAttack: false,
      boltFired: false,
      interactedDoor: null,
    };

    if (state.mode !== "playing") {
      state.player.vx = 0;
      state.player.vy = 0;
      return result;
    }

    const deltaSec = deltaMs / 1000;

    // Facing angle toward mouse
    const dx = input.mouseX - state.player.x;
    const dy = input.mouseY - state.player.y;
    if (Math.hypot(dx, dy) > 1) {
      state.player.facingAngle = Math.atan2(dy, dx);
    }

    // Movement
    this.applyMovement(state, deltaSec, input);

    // Attack on mouse down
    if (input.mouseDown) {
      if (state.player.meleeCooldownMs <= 0) {
        result.meleeAttack = true;
      } else if (state.player.boltCooldownMs <= 0) {
        result.boltFired = true;
      }
    }

    // Interact
    if (input.interactPressed) {
      result.interactedDoor = this.tryInteractDoor(state);
      this.collectNearbyPickups(state);
    }

    return result;
  }

  private applyMovement(
    state: DungeonState,
    deltaSec: number,
    input: PlayerInput,
  ): void {
    const axisX = Number(input.right) - Number(input.left);
    const axisY = Number(input.down) - Number(input.up);
    const length = Math.hypot(axisX, axisY);

    const dirX = length > 0 ? axisX / length : 0;
    const dirY = length > 0 ? axisY / length : 0;

    const vx = dirX * state.player.speed;
    const vy = dirY * state.player.speed;

    state.player.vx = vx;
    state.player.vy = vy;

    state.player.x = clamp(
      state.player.x + vx * deltaSec,
      state.player.radius,
      GAME_CONFIG.width - state.player.radius,
    );
    state.player.y = clamp(
      state.player.y + vy * deltaSec,
      state.player.radius,
      GAME_CONFIG.height - state.player.radius,
    );
  }

  private tryInteractDoor(state: DungeonState): DoorEntity | null {
    const interactRange = 50;
    for (const door of state.doors) {
      const dx = door.x + door.width / 2 - state.player.x;
      const dy = door.y + door.height / 2 - state.player.y;
      const dist = Math.hypot(dx, dy);

      if (dist > interactRange) continue;

      if (
        door.state === "locked" &&
        door.requiresKey &&
        state.inventory.keys > 0
      ) {
        state.inventory.keys -= 1;
        door.state = "unlocked";
      }

      if (door.state === "unlocked") {
        door.state = "open";
        return door;
      }
    }
    return null;
  }

  private collectNearbyPickups(state: DungeonState): void {
    const collectRange = TUNING.pickup.pickupRadius + state.player.radius;
    state.pickups = state.pickups.filter((pickup) => {
      const dist = Math.hypot(
        pickup.x - state.player.x,
        pickup.y - state.player.y,
      );
      if (dist > collectRange) return true;

      // Collected - handled by PickupSystem instead for full effect
      // Here we just flag proximity for auto-collect on interact
      return true;
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
