import Phaser from "phaser";

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json();
}

class MainScene extends Phaser.Scene {
  constructor() {
    super("MainScene");
    this.phaserManifest = null;
  }

  async preload() {
    try {
      this.phaserManifest = await fetchJson("/manifest/phaser.json");
    } catch (error) {
      this.phaserManifest = null;
      this.loadError = error instanceof Error ? error.message : String(error);
      return;
    }

    for (const atlas of this.phaserManifest.atlases ?? []) {
      this.load.atlas(atlas.key, atlas.textureURL, atlas.atlasURL);
    }

    for (const image of this.phaserManifest.standaloneImages ?? []) {
      this.load.image(image.key, image.url);
    }
  }

  create() {
    const camera = this.cameras.main;
    camera.setBackgroundColor("#12263a");

    if (!this.phaserManifest) {
      this.add.text(20, 20, "No phaser manifest found.\nRun packaging first.", {
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "18px",
      });
      if (this.loadError) {
        this.add.text(20, 90, this.loadError, {
          color: "#ffb703",
          fontFamily: "monospace",
          fontSize: "13px",
          wordWrap: { width: 760 },
        });
      }
      return;
    }

    const firstImage = this.phaserManifest.standaloneImages?.[0];
    if (firstImage) {
      this.add.image(400, 240, firstImage.key).setScale(1);
      this.add.text(20, 20, `Loaded image: ${firstImage.key}`, {
        color: "#ffffff",
        fontFamily: "monospace",
        fontSize: "16px",
      });
      return;
    }

    this.add.text(20, 20, "Manifest loaded, but no standalone image entries.", {
      color: "#ffffff",
      fontFamily: "monospace",
      fontSize: "16px",
    });
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: 800,
  height: 480,
  scene: [MainScene],
});

window.__gap_game = game;

