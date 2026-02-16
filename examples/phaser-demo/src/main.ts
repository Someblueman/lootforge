import Phaser from "phaser";

import { BootScene } from "./game/scenes/BootScene";
import { ArenaScene } from "./game/scenes/ArenaScene";
import { GAME_CONFIG } from "./game/constants";
import "./style.css";

const game = new Phaser.Game({
  type: Phaser.CANVAS,
  parent: "app",
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  backgroundColor: "#101824",
  scene: [BootScene, ArenaScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});

(window as typeof window & { __lootforgeDemo?: Phaser.Game }).__lootforgeDemo = game;
