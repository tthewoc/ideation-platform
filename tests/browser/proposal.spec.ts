import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".local/dev.env", quiet: true });
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
test("local fixture proposal needs independent disposition and explicit origin-preserving publication", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const context = await browser.newContext(),
    reviewer = await context.newPage();
  try {
    const reviewerId = await login(reviewer, "Bob");
    await login(page, "Alice");
    const fixture = await page.evaluate(async (reviewerId) => {
      const session = await (await fetch("/v1/session")).json();
      const call = async (path: string, body: any, etag?: string) => {
        const r = await fetch(path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-csrf-token": session.csrf,
            "idempotency-key": crypto.randomUUID(),
            ...(etag ? { "if-match": etag } : {}),
          },
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
      };
      const ws = await call("/v1/workspaces", {
          name: `Proposal lab ${Date.now()}`,
        }),
        base = `/v1/workspaces/${ws.id}`;
      await call(
        `${base}/memberships`,
        { user_id: reviewerId, roles: ["member", "reviewer"] },
        '"1"',
      );
      const o = await call(`${base}/objects`, {
        type: "observation",
        schema_version: 1,
        content: {
          title: "Protocol baseline for local test",
          body: "Synthetic measurement only.",
          language: "en",
          source_refs: [],
          context: "Local pipeline test",
          observed_at: null,
        },
      });
      const source = await call(
        `${base}/objects/${o.id}/publish`,
        { revision: 1, confirmation: true },
        o.etag,
      );
      return { w: ws.id, source };
    }, reviewerId);
    await page.reload();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(fixture.w);
    await page
      .getByText("Local proposal workflow test — no AI model", { exact: true })
      .click();
    const lab = page.getByRole("region", { name: "Local proposal workflow" });
    await lab
      .getByRole("listbox", {
        name: "Published inputs for local test",
        exact: true,
      })
      .selectOption(`${fixture.source.id}:${fixture.source.revision}`);
    await lab.getByLabel("Independent proposal reviewer ID").fill(reviewerId);
    await lab
      .getByLabel("Workflow test instruction")
      .fill("Exercise attribution and review using this synthetic source");
    await lab
      .getByLabel("I understand this is a local test adapter, not live AI.")
      .check();
    await lab
      .getByRole("button", { name: "Queue local proposal test" })
      .click();
    await expect(
      lab.getByRole("log", { name: "Proposal workflow update" }),
    ).toContainText("Local fixture queued");
    await expect(async () => {
      await lab
        .getByRole("button", { name: "Refresh proposal workflow" })
        .click();
      await expect(lab.getByRole("article")).toContainText(
        "Local workflow fixture",
      );
    }).toPass({ timeout: 30000, intervals: [1000] });
    await expect(
      page
        .getByRole("region", { name: "Knowledge objects" })
        .getByRole("button"),
    ).toHaveCount(1);
    await reviewer.reload();
    await reviewer
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(fixture.w);
    await reviewer
      .getByText("Local proposal workflow test — no AI model", { exact: true })
      .click();
    const reviewLab = reviewer.getByRole("region", {
      name: "Local proposal workflow",
    });
    await reviewLab
      .getByRole("button", { name: "Refresh proposal workflow" })
      .click();
    await reviewLab
      .getByRole("combobox", { name: "Proposal disposition", exact: true })
      .selectOption("needs_evidence");
    await reviewLab
      .getByLabel("Proposal decision reason")
      .fill(
        "Fixture attribution verified; no scientific acceptance is claimed",
      );
    await reviewLab
      .getByLabel(
        "I am independent and have no conflict in this proposal review.",
      )
      .check();
    await reviewLab
      .getByRole("button", { name: "Record proposal disposition" })
      .click();
    await expect(
      reviewLab.getByRole("log", { name: "Proposal workflow update" }),
    ).toContainText("Nothing was published");
    await lab
      .getByRole("button", { name: "Refresh proposal workflow" })
      .click();
    await lab
      .getByRole("button", { name: "Inspect run and review history" })
      .click();
    await expect(
      lab.getByRole("region", { name: "Run and review history" }),
    ).toContainText("Fixture attribution verified");
    const revisionSelect = lab.getByLabel("Revise a previous proposal");
    const previous = await revisionSelect
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await revisionSelect.selectOption(previous!);
    await lab
      .getByLabel("Workflow test instruction")
      .fill("Revised scope: keep this synthetic attribution explicit");
    await lab
      .getByRole("button", { name: "Queue local proposal test" })
      .click();
    await expect(async () => {
      await lab
        .getByRole("button", { name: "Refresh proposal workflow" })
        .click();
      await expect(lab.getByRole("article")).toHaveCount(2);
    }).toPass({ timeout: 30000, intervals: [1000] });
    await expect(
      lab.getByRole("button", { name: "Publish accepted fixture" }),
    ).toHaveCount(0);
    await reviewLab
      .getByRole("button", { name: "Refresh proposal workflow" })
      .click();
    const pending = reviewLab.getByRole("article").filter({
      has: reviewer.getByRole("combobox", {
        name: "Proposal disposition",
        exact: true,
      }),
    });
    await pending
      .getByRole("button", { name: "Inspect run and review history" })
      .click();
    await expect(
      pending.getByRole("region", { name: "Run and review history" }),
    ).toContainText(previous!);
    await expect(
      pending.getByRole("region", { name: "Run and review history" }),
    ).toContainText("No independent decision recorded");
    await pending
      .getByRole("combobox", { name: "Proposal disposition", exact: true })
      .selectOption("accepted");
    await pending
      .getByLabel("Proposal decision reason")
      .fill("Revised attribution verified with the supplied source");
    await pending
      .getByLabel(
        "I am independent and have no conflict in this proposal review.",
      )
      .check();
    await pending
      .getByRole("button", { name: "Record proposal disposition" })
      .click();
    await expect(
      reviewLab.getByRole("article").filter({ hasText: "· accepted" }),
    ).toHaveCount(1);
    await lab
      .getByRole("button", { name: "Refresh proposal workflow" })
      .click();
    await lab
      .getByLabel("Publish this accepted fixture to all workspace members.")
      .check();
    await lab.getByRole("button", { name: "Publish accepted fixture" }).click();
    await expect(
      lab.getByRole("log", { name: "Proposal workflow update" }),
    ).toContainText("published explicitly");
    await page
      .getByRole("region", { name: "Knowledge objects" })
      .getByRole("button")
      .filter({ hasText: "Local workflow fixture" })
      .click();
    const details = page.getByRole("region", { name: "Object details" });
    await expect(details).toContainText("AI-origin workflow fixture");
    await expect(details).toContainText("unreviewed");
    await expect(
      details.getByRole("button", { name: "Create correction", exact: true }),
    ).toHaveCount(0);
    await expect(lab).toContainText(
      "Published; review deadline no longer applies",
    );
    await lab.getByLabel("Revise a previous proposal").selectOption("");
    await lab
      .getByRole("button", { name: "Queue local proposal test" })
      .click();
    await expect(async () => {
      await lab
        .getByRole("button", { name: "Refresh proposal workflow" })
        .click();
      await expect(lab.getByRole("article")).toHaveCount(3);
    }).toPass({ timeout: 30000, intervals: [1000] });
    const admin = new pg.Pool({
      connectionString: process.env.DATABASE_ADMIN_URL,
    });
    try {
      await admin.query(
        "UPDATE ai_proposals SET expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND published_refs IS NULL",
        [fixture.w],
      );
    } finally {
      await admin.end();
    }
    await lab
      .getByRole("button", { name: "Refresh proposal workflow" })
      .click();
    await expect(
      lab.getByText("Expired — history only", { exact: false }),
    ).toHaveCount(2);
    await expect(
      lab.getByLabel("Revise a previous proposal").locator("option"),
    ).toHaveCount(1);
    await reviewLab
      .getByRole("button", { name: "Refresh proposal workflow" })
      .click();
    await expect(
      reviewLab.getByRole("combobox", {
        name: "Proposal disposition",
        exact: true,
      }),
    ).toHaveCount(0);
    const expiredPending = reviewLab
      .getByRole("article")
      .filter({ hasText: "· pending" });
    await expiredPending
      .getByRole("button", { name: "Inspect run and review history" })
      .click();
    await expect(
      expiredPending.getByRole("region", { name: "Run and review history" }),
    ).toContainText("No independent decision recorded");
    const a11y = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(a11y.violations).toEqual([]);
    await page.screenshot({
      path: ".local/proposal-workflow.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
