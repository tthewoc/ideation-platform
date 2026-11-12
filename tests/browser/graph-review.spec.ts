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
}
async function publish(page: Page) {
  await page
    .getByRole("button", { name: "Review publication", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm publication", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText(
    "Published to your workspace.",
  );
}
async function structured(page: Page, type: string, title: string) {
  await page.getByRole("button", { name: "New structured knowledge" }).click();
  await page.getByLabel("Knowledge type").selectOption(type);
  await page.getByLabel("Title", { exact: true }).fill(title);
}
async function saveStructured(page: Page) {
  await page.getByRole("button", { name: "Save structured draft" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Private structured draft saved.",
  );
}
test("independent private review, explicit publication, evidence assessment and graph explorer", async ({
  page,
  browser,
}) => {
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  try {
    await login(reviewer, "Bob");
    const reviewerId = await reviewer.evaluate(
      async () => (await (await fetch("/v1/session")).json()).user.id,
    );
    await login(page, "Alice");
    const workspaceName = `Review workspace ${Date.now()}`;
    await page.getByLabel("New workspace name").fill(workspaceName);
    await page
      .getByRole("button", { name: "Create workspace", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Workspace created.");
    await page.getByText("Workspace membership", { exact: true }).click();
    await page.getByLabel("Registered user ID").fill(reviewerId);
    await page.getByLabel("reviewer", { exact: true }).check();
    await page.getByRole("button", { name: "Add member", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Member added.");
    await page
      .getByRole("button", { name: "New observation or claim" })
      .click();
    await page
      .getByRole("combobox", { name: "Type", exact: true })
      .selectOption("claim");
    await page.getByLabel("Title", { exact: true }).fill("Reviewed claim");
    await page
      .getByLabel("Proposition / description")
      .fill("Cooling decreases at the specified load.");
    await page
      .getByLabel("Scope", { exact: true })
      .fill("Synthetic apparatus only");
    await page.getByRole("button", { name: "Save private draft" }).click();
    await expect(page.getByRole("status")).toHaveText("Private draft saved.");
    await page
      .getByLabel("Reviewer user IDs (comma separated)")
      .fill(reviewerId);
    await page.getByLabel("Review purpose").fill("Check attribution and scope");
    await page.getByRole("button", { name: "Submit exact revision" }).click();
    await expect(page.getByLabel("Graph and review update")).toContainText(
      "Exact revision submitted",
    );
    await reviewer.reload();
    await reviewer
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption({ label: workspaceName });
    await reviewer
      .getByRole("button", { name: "Load review submissions" })
      .click();
    await reviewer
      .getByRole("button", { name: "Inspect submitted revision" })
      .click();
    await expect(
      reviewer.getByRole("region", { name: "Object details" }),
    ).toContainText("Submitted for review");
    await reviewer
      .getByRole("combobox", { name: "Review decision", exact: true })
      .selectOption("accepted");
    await reviewer
      .getByLabel("Review reason", { exact: true })
      .fill("The scoped proposition is attributable.");
    await reviewer.getByLabel("I am independent and have no conflict.").check();
    await reviewer
      .getByRole("button", { name: "Record review decision", exact: true })
      .click();
    await expect(reviewer.getByLabel("Graph and review update")).toContainText(
      "Review decision recorded",
    );
    await page.reload();
    await page
      .getByRole("region", { name: "Knowledge objects" })
      .getByRole("button")
      .filter({ hasText: "Reviewed claim" })
      .click();
    await expect(
      page.getByRole("region", { name: "Object details" }),
    ).toContainText("accepted");
    await publish(page);
    await structured(page, "method", "Assessment protocol");
    await page
      .getByLabel("Protocol steps — one per line")
      .fill("Inspect source\nCompare against scoped claim");
    await page
      .getByLabel("Measured metrics — one per line")
      .fill("Source consistency");
    await saveStructured(page);
    await publish(page);
    await structured(page, "evidence", "Synthetic cooling dataset");
    await page
      .getByLabel("Source", { exact: true })
      .fill("Synthetic experiment D");
    await page
      .getByLabel("Acquisition context", { exact: true })
      .fill("Controlled bench measurement");
    await saveStructured(page);
    await publish(page);
    await structured(page, "assessment", "Scoped evidence interpretation");
    await page
      .getByLabel("Claim or hypothesis revision")
      .selectOption({ label: "Reviewed claim · claim · r2" });
    await page
      .getByRole("combobox", { name: "Evidence revision", exact: true })
      .selectOption({ label: "Synthetic cooling dataset · evidence · r2" });
    await page
      .getByLabel("Assessment method revision")
      .selectOption({ label: "Assessment protocol · method · r2" });
    await page
      .getByRole("combobox", { name: "Evidence interpretation", exact: true })
      .selectOption("qualifies");
    await page
      .getByLabel("Assessment scope")
      .fill("Only the measured load range");
    await page
      .getByLabel("Interpretation rationale")
      .fill("The dataset supports a narrower scope.");
    await page
      .getByLabel("Uncertainty rationale")
      .fill("No independent replication");
    await saveStructured(page);
    await publish(page);
    await page
      .getByLabel("Starting object")
      .selectOption({ label: "Reviewed claim" });
    await page.getByLabel("Traversal depth").selectOption("1");
    await page.getByRole("button", { name: "Explore connections" }).click();
    await expect(page.getByRole("table")).toContainText("qualifies");
    await expect(page.getByRole("table")).toContainText(
      "Only the measured load range",
    );
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({ path: ".local/graph-review.png", fullPage: true });
  } finally {
    await reviewerContext.close();
  }
});
