import Phaser from "phaser";

import { AssetRegistry } from "../AssetRegistry";
import { REQUIRED_ASSET_IDS } from "../constants";

export class BootScene extends Phaser.Scene {
  constructor() {
    super("BootScene");
  }

  preload(): void {
    this.load.json("atlasManifest", "/assets/atlases/manifest.json");
    this.load.json("catalog", "/assets/imagegen/processed/catalog.json");
  }

  create(): void {
    try {
      const atlasManifest = this.cache.json.get("atlasManifest");
      const catalog = this.cache.json.get("catalog");
      const registry = AssetRegistry.fromRaw(atlasManifest, catalog);

      registry.assertIds(REQUIRED_ASSET_IDS);
      this.registry.set("assetRegistry", registry);

      registry.enqueueLoaderAssets(this.load);
      this.load.once(Phaser.Loader.Events.COMPLETE, () => {
        this.scene.start("GameScene");
      });
      this.load.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.cameras.main.setBackgroundColor("#0f1720");
      this.add
        .text(
          20,
          20,
          `Asset bootstrap failed.\n${message}\n\nRun npm run demo:dungeon:assets:plan && npm run demo:dungeon:assets:generate && npm run demo:dungeon:assets:process && npm run demo:dungeon:assets:atlas`,
          {
            color: "#f8fafc",
            fontFamily: "monospace",
            fontSize: "16px",
            wordWrap: { width: 900 },
          },
        )
        .setDepth(10);
    }
  }
}
