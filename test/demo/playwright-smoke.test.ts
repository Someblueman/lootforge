import { test, expect } from "@playwright/test";

test("game boots, canvas renders, and state is playable", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/");

  // Wait for canvas to appear
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 10000 });

  // Click to focus
  await canvas.click();

  // Wait for game to initialize (automation hooks installed)
  await page.waitForFunction(
    () => typeof (window as any).render_game_to_text === "function",
    { timeout: 10000 },
  );

  // Read initial game state
  const stateJson = await page.evaluate(() =>
    (window as any).render_game_to_text(),
  );
  const state = JSON.parse(stateJson);

  expect(state.mode).toBe("playing");
  expect(state.currentRoom).toBe("crypt_entrance");
  expect(state.enemies.length).toBeGreaterThan(0);
  expect(state.player.hp).toBe(state.player.maxHp);

  // Simulate movement: press D to move right
  const initialX = state.player.x;

  await page.keyboard.down("d");
  await page.waitForTimeout(200);
  await page.keyboard.up("d");

  const afterMoveJson = await page.evaluate(() =>
    (window as any).render_game_to_text(),
  );
  const afterMove = JSON.parse(afterMoveJson);
  expect(afterMove.player.x).toBeGreaterThan(initialX);

  // Click to attack -- verify melee fires (cooldown was the main bug)
  await canvas.click({ position: { x: 500, y: 270 } });
  await page.waitForTimeout(100);

  const afterAttackJson = await page.evaluate(() =>
    (window as any).render_game_to_text(),
  );
  const afterAttack = JSON.parse(afterAttackJson);

  // Game should still be playing (no crash from attack)
  expect(afterAttack.mode).toBe("playing");

  // No unexpected console errors (ignore WebGL warnings)
  const realErrors = consoleErrors.filter(
    (e) => !e.includes("WebGL") && !e.includes("devicePixelRatio"),
  );
  expect(realErrors).toEqual([]);
});

test("advanceTime progresses game state", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 10000 });
  await canvas.click();

  await page.waitForFunction(
    () => typeof (window as any).render_game_to_text === "function",
    { timeout: 10000 },
  );

  // Get initial state
  const initialJson = await page.evaluate(() =>
    (window as any).render_game_to_text(),
  );
  const initial = JSON.parse(initialJson);
  expect(initial.enemies.length).toBeGreaterThan(0);

  // Advance time -- enemies should move toward player
  const enemyBefore = initial.enemies[0];
  await page.evaluate(() => (window as any).advanceTime(2000));

  const afterJson = await page.evaluate(() =>
    (window as any).render_game_to_text(),
  );
  const after = JSON.parse(afterJson);

  // Enemies should have moved (their positions changed)
  const enemyAfter = after.enemies.find((e: any) => e.id === enemyBefore.id);
  if (enemyAfter) {
    const moved =
      Math.abs(enemyAfter.x - enemyBefore.x) > 1 ||
      Math.abs(enemyAfter.y - enemyBefore.y) > 1;
    expect(moved).toBe(true);
  }

  // Game should still be playing
  expect(after.mode).toBe("playing");
});
