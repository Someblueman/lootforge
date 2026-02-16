import Phaser from "phaser";

import { AssetRegistry } from "../AssetRegistry";
import { DEMO_ASSET_IDS, DEPTH, GAME_CONFIG } from "../constants";
import type { DungeonState } from "../types";

const BAR_WIDTH = 140;
const BAR_HEIGHT = 14;
const BAR_X = 48;
const BAR_Y = 18;

const FONT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
  fontSize: "16px",
  color: "#f4f7fb",
  stroke: "#1a0a12",
  strokeThickness: 3,
};

function hpBarColor(ratio: number): number {
  if (ratio > 0.6) return 0x44cc44;
  if (ratio > 0.3) return 0xcccc22;
  return 0xcc2222;
}

export class Hud {
  private readonly barBg: Phaser.GameObjects.Graphics;
  private readonly barFill: Phaser.GameObjects.Graphics;
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly keyText: Phaser.GameObjects.Text;
  private readonly goldText: Phaser.GameObjects.Text;
  private readonly roomText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, assetRegistry?: AssetRegistry) {
    // Health bar background
    this.barBg = scene.add.graphics().setDepth(DEPTH.hud).setScrollFactor(0);
    this.barBg.fillStyle(0x111111, 0.7);
    this.barBg.fillRoundedRect(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, 3);
    this.barBg.lineStyle(1, 0x888888, 0.4);
    this.barBg.strokeRoundedRect(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, 3);

    // Health bar fill
    this.barFill = scene.add.graphics().setDepth(DEPTH.hud).setScrollFactor(0);

    // HP icon
    if (assetRegistry) {
      try {
        const hpIcon = assetRegistry.requireVisual(DEMO_ASSET_IDS.uiHealth);
        scene.add
          .sprite(
            BAR_X - 16,
            BAR_Y + BAR_HEIGHT / 2,
            hpIcon.textureKey,
            hpIcon.frame,
          )
          .setDisplaySize(20, 20)
          .setDepth(DEPTH.hud)
          .setScrollFactor(0);
      } catch {
        /* icon not loaded */
      }
    }

    // HP text
    this.hpText = scene.add
      .text(BAR_X + BAR_WIDTH + 8, BAR_Y - 1, "", {
        ...FONT_STYLE,
        fontSize: "13px",
      })
      .setDepth(DEPTH.hud)
      .setScrollFactor(0);

    // Key icon + count
    const keyTextX = BAR_X;
    if (assetRegistry) {
      try {
        const keyIcon = assetRegistry.requireVisual(DEMO_ASSET_IDS.uiKey);
        scene.add
          .sprite(
            keyTextX - 16,
            BAR_Y + BAR_HEIGHT + 18,
            keyIcon.textureKey,
            keyIcon.frame,
          )
          .setDisplaySize(20, 20)
          .setDepth(DEPTH.hud)
          .setScrollFactor(0);
      } catch {
        /* icon not loaded */
      }
    }
    this.keyText = scene.add
      .text(keyTextX, BAR_Y + BAR_HEIGHT + 10, "", FONT_STYLE)
      .setDepth(DEPTH.hud)
      .setScrollFactor(0);

    // Gold icon + count
    const goldTextX = BAR_X + 80;
    if (assetRegistry) {
      try {
        const goldIcon = assetRegistry.requireVisual(DEMO_ASSET_IDS.uiGold);
        scene.add
          .sprite(
            goldTextX - 16,
            BAR_Y + BAR_HEIGHT + 18,
            goldIcon.textureKey,
            goldIcon.frame,
          )
          .setDisplaySize(20, 20)
          .setDepth(DEPTH.hud)
          .setScrollFactor(0);
      } catch {
        /* icon not loaded */
      }
    }
    this.goldText = scene.add
      .text(goldTextX, BAR_Y + BAR_HEIGHT + 10, "", FONT_STYLE)
      .setDepth(DEPTH.hud)
      .setScrollFactor(0);

    // Room name (top center)
    this.roomText = scene.add
      .text(GAME_CONFIG.width / 2, 10, "", {
        ...FONT_STYLE,
        fontSize: "13px",
        color: "#aa9977",
      })
      .setOrigin(0.5, 0)
      .setDepth(DEPTH.hud)
      .setScrollFactor(0);
  }

  update(state: DungeonState): void {
    const ratio = state.player.hp / state.player.maxHp;
    const fillWidth = Math.max(0, BAR_WIDTH * ratio);

    this.barFill.clear();
    this.barFill.fillStyle(hpBarColor(ratio), 1);
    this.barFill.fillRoundedRect(BAR_X, BAR_Y, fillWidth, BAR_HEIGHT, 3);

    this.hpText.setText(`${Math.ceil(state.player.hp)}/${state.player.maxHp}`);
    this.keyText.setText(`Keys: ${state.inventory.keys}`);
    this.goldText.setText(`Gold: ${state.inventory.gold}`);

    const roomLabel = state.currentRoom.replace(/_/g, " ").toUpperCase();
    this.roomText.setText(roomLabel);
  }
}
