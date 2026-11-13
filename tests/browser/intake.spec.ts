import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function login(page: Page, name: string) {
  await page.context().addCookies([
    {
      name: "ideator_test_group",
      value: test.info().testId.replaceAll(/[^a-zA-Z0-9_-]/g, ""),
      url: "http://127.0.0.1:3001",
    },
  ]);
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: `Continue as ${name}` }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  return page.evaluate(
    async () => (await (await fetch("/v1/session")).json()).user.id,
  );
}
test("private partial notes preserve wording, undo branches without deletion and remain hidden from another member", async ({
  page,
  browser,
}) => {
  const context = await browser.newContext(),
    peer = await context.newPage();
  try {
    const peerId = await login(peer, "Bob");
    await login(page, "Alice");
    const w = await page.evaluate(async (peerId) => {
      const s = await (await fetch("/v1/session")).json();
      const call = async (path: string, body: any, etag?: string) => {
        const r = await fetch(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": s.csrf,
            "idempotency-key": crypto.randomUUID(),
            ...(etag ? { "if-match": etag } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`Setup failed: ${r.status}`);
        return r.json();
      };
      const ws = await call("/v1/workspaces", {
        name: `Notebook ${Date.now()}`,
      });
      await call(
        `/v1/workspaces/${ws.id}/memberships`,
        { user_id: peerId, roles: ["member", "reviewer"] },
        ws.etag,
      );
      return ws.id;
    }, peerId);
    await page.reload();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(w);
    await page.getByText("Private idea notebook", { exact: true }).click();
    const lab = page.getByRole("region", {
      name: "Private conversational intake",
    });
    await lab.getByLabel("Notebook title").fill("Unfinished cooling idea");
    await lab.getByRole("button", { name: "Create private notebook" }).click();
    const selected = lab.getByRole("region", { name: "Selected notebook" });
    await expect(
      selected.getByRole("heading", { name: "Unfinished cooling idea" }),
    ).toBeVisible();
    const original = "  Could this work?\n未完成 — only a fragment.  ";
    await selected.getByLabel("Original note").fill(original);
    await selected.getByRole("button", { name: "Save partial note" }).click();
    await expect(
      selected.getByRole("article", { name: "Saved turn 1" }).locator(".body"),
    ).toHaveText(original, { useInnerText: false });
    await selected
      .getByLabel("Original note")
      .fill("Second thought, still incomplete");
    await selected.getByRole("button", { name: "Save partial note" }).click();
    await expect(
      selected.getByRole("article", { name: "Saved turn 2" }),
    ).toContainText("Active");
    await selected
      .getByLabel("Restore saved turn")
      .selectOption({ label: "Turn 1" });
    await selected
      .getByLabel("Reason for restoring")
      .fill("Try a different direction from the original");
    await selected.getByRole("button", { name: "Restore active turn" }).click();
    await expect(
      selected.getByRole("article", { name: "Saved turn 1" }),
    ).toContainText("Active");
    await expect(
      selected.getByRole("article", { name: "Saved turn 2" }),
    ).toContainText("Second thought");
    await selected.getByLabel("Original note").fill("Alternative continuation");
    await selected.getByRole("button", { name: "Save partial note" }).click();
    await expect(
      selected.getByRole("article", { name: "Saved turn 3" }),
    ).toContainText("Continues from turn 1");
    await page.reload();
    await page.getByText("Private idea notebook", { exact: true }).click();
    await lab
      .getByRole("button", { name: "Refresh private notebooks" })
      .click();
    await lab
      .getByRole("button", { name: "Unfinished cooling idea", exact: true })
      .click();
    expect(
      await selected
        .getByRole("article", { name: "Saved turn 1" })
        .locator(".body")
        .textContent(),
    ).toBe(original);
    await expect(selected).toContainText(
      "Try a different direction from the original",
    );
    await expect(
      page
        .getByRole("region", { name: "Knowledge objects" })
        .getByRole("button"),
    ).toHaveCount(0);
    await peer.reload();
    await peer
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(w);
    await peer.getByText("Private idea notebook", { exact: true }).click();
    const peerLab = peer.getByRole("region", {
      name: "Private conversational intake",
    });
    await peerLab
      .getByRole("button", { name: "Refresh private notebooks" })
      .click();
    await expect(
      peerLab.getByRole("button", {
        name: "Unfinished cooling idea",
        exact: true,
      }),
    ).toHaveCount(0);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({
      path: ".local/private-intake.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
