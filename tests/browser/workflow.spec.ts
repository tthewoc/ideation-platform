import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("OIDC, private draft, publication, correction history and project reuse", async ({
  page,
}) => {
  await page.context().addCookies([
    {
      name: "ideator_test_group",
      value: test.info().testId.replaceAll(/[^a-zA-Z0-9_-]/g, ""),
      url: "http://127.0.0.1:3001",
    },
  ]);
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Continue as Alice" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page
    .getByLabel("New workspace name")
    .fill(`Browser research ${Date.now()}`);
  await page
    .getByRole("button", { name: "Create workspace", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Workspace created.");
  await page.getByRole("button", { name: "New observation or claim" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Cooling experiment");
  await page
    .getByLabel("What did you observe?")
    .fill("The plate cooled under forced air.");
  await page
    .getByLabel("Context", { exact: true })
    .fill("Synthetic bench observation");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Private draft saved.");
  await page.getByRole("button", { name: "Review publication" }).click();
  await expect(
    page.getByRole("complementary", { name: "Publication confirmation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm publication" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Published to your workspace.",
  );
  await page.getByRole("button", { name: "View history", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Revision history" }),
  ).toContainText("Explicit workspace publication");
  for (const name of ["Thermal thesis", "Material thesis"]) {
    await page.getByLabel("Project name", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  for (const name of ["Thermal thesis", "Material thesis"])
    await page
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByRole("button", { name: "Add selected object" })
      .click();
  await expect(page.getByRole("status")).toHaveText("Reference added.");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("article")
    .filter({
      has: page.getByRole("heading", { name: "Thermal thesis", exact: true }),
    })
    .getByRole("button", { name: "Remove project", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Thermal thesis", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "View references" }).click();
  await expect(
    page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Material thesis",
        exact: true,
      }),
    }),
  ).toContainText("Cooling experiment");
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Create correction" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Reason for this revision")).toBeVisible();
  await page
    .getByLabel("Title", { exact: true })
    .fill("Corrected cooling observation");
  await page.getByLabel("Reason for this revision").fill("Clarify scope");
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Private draft saved.");
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page
    .getByLabel("Title", { exact: true })
    .fill("My preserved concurrent edit");
  await page
    .getByLabel("Reason for this revision")
    .fill("Reconcile another edit");
  await page.evaluate(async () => {
    const session = await (await fetch("/v1/session")).json();
    const select = document.querySelector("select") as HTMLSelectElement;
    const base = `/v1/workspaces/${select.value}`;
    const list = await (await fetch(`${base}/objects`)).json();
    const object = list.items.find(
      (o: any) => o.content.title === "Corrected cooling observation",
    );
    const r = await fetch(`${base}/objects/${object.id}/draft`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": session.csrf,
        "idempotency-key": crypto.randomUUID(),
        "if-match": object.etag,
      },
      body: JSON.stringify({
        content: { ...object.content, title: "Another saved edit" },
        reason: "Concurrent browser fixture",
      }),
    });
    if (!r.ok) throw new Error(`Concurrent fixture failed: ${r.status}`);
  });
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(
    page.getByRole("heading", { name: "A newer revision is available" }),
  ).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(
    "My preserved concurrent edit",
  );
  await page
    .getByRole("button", { name: "Use latest version as base" })
    .click();
  await page.getByRole("button", { name: "Save private draft" }).click();
  await expect(page.getByRole("status")).toHaveText("Private draft saved.");
  await page.screenshot({ path: ".local/workspace.png", fullPage: true });
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("link", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
