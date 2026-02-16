import Phaser from "phaser";

import { DEPTH, GAME_CONFIG } from "../constants";
import type { RoomId } from "../types";

const ROOM_LABELS: Record<RoomId, string> = {
  crypt_entrance: "CRYPT ENTRANCE",
  treasure_hall: "TREASURE HALL",
  throne_room: "THRONE ROOM",
};

/** Slide-in banner showing room name. Self-destructs after display. */
export function showRoomTitle(scene: Phaser.Scene, roomId: RoomId): void {
  const label = ROOM_LABELS[roomId];

  const text = scene.add
    .text(GAME_CONFIG.width / 2, -40, label, {
      fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
      fontSize: "28px",
      color: "#ddc888",
      stroke: "#1a0a08",
      strokeThickness: 5,
      align: "center",
    })
    .setOrigin(0.5)
    .setDepth(DEPTH.overlay)
    .setScrollFactor(0)
    .setAlpha(0);

  // Slide in
  scene.tweens.add({
    targets: text,
    y: 60,
    alpha: 1,
    duration: 400,
    ease: "Back.easeOut",
    onComplete: () => {
      // Hold, then fade out
      scene.time.delayedCall(2000, () => {
        scene.tweens.add({
          targets: text,
          alpha: 0,
          y: 40,
          duration: 400,
          ease: "Cubic.easeIn",
          onComplete: () => text.destroy(),
        });
      });
    },
  });
}
