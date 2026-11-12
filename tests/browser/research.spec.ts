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
async function board(page: Page, w: string) {
  await page.reload();
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption(w);
  await page.getByRole("button", { name: "Refresh research board" }).click();
  await page.getByRole("button", { name: /Null replication task ·/ }).click();
}
test("consented research, scanned artifact, null outcome and independent completion", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const bobContext = await browser.newContext(),
    eveContext = await browser.newContext(),
    bob = await bobContext.newPage(),
    eve = await eveContext.newPage();
  try {
    const bobId = await login(bob, "Bob"),
      eveId = await login(eve, "Eve");
    await login(page, "Alice");
    const fixture = await page.evaluate(
      async ({ bobId, eveId }) => {
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
          if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
          return r.json();
        };
        const w = await call("/v1/workspaces", {
            name: `Research browser ${Date.now()}`,
          }),
          base = `/v1/workspaces/${w.id}`;
        let membershipVersion = 1;
        for (const [id, roles] of [
          [session.user.id, ["member", "admin", "coordinator"]],
          [bobId, ["member"]],
          [eveId, ["member", "reviewer"]],
        ])
          await call(
            `${base}/memberships`,
            { user_id: id, roles },
            `"${membershipVersion++}"`,
          );
        const common = {
          body: "Synthetic fixture",
          language: "en",
          source_refs: [],
        };
        const make = async (type: string, content: any) => {
          const o = await call(`${base}/objects`, {
            type,
            schema_version: 1,
            content: { ...common, ...content },
          });
          return call(
            `${base}/objects/${o.id}/publish`,
            { revision: o.revision, confirmation: true },
            o.etag,
          );
        };
        const method = await make("method", {
          title: "Temperature protocol",
          ordered_steps: ["Record samples"],
          metrics: ["Temperature"],
          constraints: [],
          ethical_constraints: [],
        });
        await make("research_task", {
          title: "Null replication task",
          rationale: "Record an unbiased outcome",
          method_ref: { id: method.id, revision: method.revision },
          acceptance_criteria: ["All measurements retained"],
        });
        return { w: w.id };
      },
      { bobId, eveId },
    );
    await page.reload();
    await page
      .getByRole("combobox", { name: "Workspace", exact: true })
      .selectOption(fixture.w);
    const taskValue = await page
      .getByRole("combobox", { name: "Task definition", exact: true })
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await page
      .getByRole("combobox", { name: "Task definition", exact: true })
      .selectOption(taskValue!);
    await page.getByLabel("Reason to open").fill("Ready for replication");
    await page.getByRole("button", { name: "Open task", exact: true }).click();
    await page.getByLabel("Invited assignee user ID").fill(bobId);
    await page
      .getByLabel("Invitation purpose")
      .fill("Measure under the published protocol");
    await page.getByRole("button", { name: "Invite assignee" }).click();
    await expect(
      page.getByRole("log", { name: "Research update" }),
    ).toContainText("Invitation recorded");
    await board(bob, fixture.w);
    await bob
      .getByLabel("Assignment decision reason")
      .fill("I am available and accept");
    await bob
      .getByRole("button", { name: "Record assignment decision" })
      .click();
    await expect(
      bob.getByRole("region", { name: "Research task details" }),
    ).toContainText("Work status: assigned");
    await bob
      .getByRole("combobox", { name: "Task action", exact: true })
      .selectOption("start");
    await bob
      .getByLabel("Task transition reason")
      .fill("Prerequisites checked");
    await bob.getByRole("button", { name: "Record task transition" }).click();
    await expect(
      bob.getByRole("region", { name: "Research task details" }),
    ).toContainText("Work status: in progress");
    await bob.getByLabel("Artifact title").fill("Null trial measurements");
    await bob.getByLabel("License or usage terms").fill("CC0-1.0");
    await bob.getByLabel("Artifact file").setInputFiles({
      name: "measurements.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("temperature\n20\n20\n"),
    });
    await bob
      .getByRole("button", { name: "Register artifact", exact: true })
      .click();
    await expect(
      bob.getByRole("log", { name: "Research update" }),
    ).toContainText("quarantined");
    await expect(async () => {
      await bob.getByRole("button", { name: "Refresh research board" }).click();
      await expect(
        bob.getByRole("link", { name: /Download artifact/ }),
      ).toBeVisible();
    }).toPass({ timeout: 70000, intervals: [1500] });
    await publish(bob);
    await bob
      .getByLabel("Result title", { exact: true })
      .fill("No detectable temperature change");
    await bob
      .getByRole("combobox", { name: "Research outcome", exact: true })
      .selectOption("null");
    await bob
      .getByLabel("Measurement context", { exact: true })
      .fill("Synthetic temperatures sampled every second");
    const artifactValue = await bob
      .getByRole("listbox", {
        name: "Published result artifacts (optional)",
        exact: true,
      })
      .locator("option")
      .first()
      .getAttribute("value");
    await bob
      .getByRole("listbox", {
        name: "Published result artifacts (optional)",
        exact: true,
      })
      .selectOption(artifactValue!);
    await bob.getByRole("button", { name: "Save research result" }).click();
    await expect(
      bob.getByRole("log", { name: "Research update" }),
    ).toContainText("Private research result saved");
    await publish(bob);
    await bob
      .getByRole("combobox", { name: "Task action", exact: true })
      .selectOption("submit");
    const resultValue = await bob
      .getByRole("combobox", { name: "Published task result", exact: true })
      .locator("option")
      .nth(1)
      .getAttribute("value");
    await bob
      .getByRole("combobox", { name: "Published task result", exact: true })
      .selectOption(resultValue!);
    await bob
      .getByLabel("Evidence for: All measurements retained")
      .fill("CSV contains every measured value");
    await bob
      .getByLabel("Task transition reason")
      .fill("Ready for independent check");
    await bob.getByRole("button", { name: "Record task transition" }).click();
    await expect(
      bob.getByRole("region", { name: "Research task details" }),
    ).toContainText("Work status: submitted");
    await board(eve, fixture.w);
    await expect(async () => {
      await eve.getByRole("button", { name: "Refresh research board" }).click();
      await expect(
        eve.getByRole("region", { name: "Research task details" }),
      ).toContainText("Result freshness: current");
    }).toPass({ timeout: 15000, intervals: [1000] });
    await eve
      .getByRole("combobox", { name: "Task action", exact: true })
      .selectOption("complete");
    await eve
      .getByLabel("Task transition reason")
      .fill("Criteria met; null outcome preserved");
    await eve.getByLabel("I have no conflict in this review.").check();
    await eve.getByRole("button", { name: "Record task transition" }).click();
    await expect(
      eve.getByRole("region", { name: "Research task details" }),
    ).toContainText("Work status: completed");
    await expect(
      eve.getByRole("button", {
        name: "Null replication task · completed",
        exact: true,
      }),
    ).toBeVisible();
    await eve.getByRole("button", { name: "Inspect submitted result" }).click();
    await expect(
      eve.getByRole("region", { name: "Structured knowledge details" }),
    ).toContainText("null");
    await bob
      .getByRole("button", { name: "Create correction", exact: true })
      .click();
    await expect(
      bob
        .getByRole("listbox", {
          name: "Artifact revisions (optional)",
          exact: true,
        })
        .locator("option:checked"),
    ).toHaveCount(1);
    await bob
      .getByLabel("Reason for this revision")
      .fill("Clarify measurement context while retaining raw data");
    await bob
      .getByRole("button", { name: "Save structured draft", exact: true })
      .click();
    await expect(bob.getByRole("status")).toHaveText(
      "Private structured draft saved.",
    );
    const corrected = await bob.evaluate(
      async (path) => await (await fetch(path)).json(),
      `/v1/workspaces/${fixture.w}/objects/${resultValue!.split(":")[0]}`,
    );
    expect(corrected.content.artifact_refs).toHaveLength(1);
    const a11y = await new AxeBuilder({ page: eve })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(a11y.violations).toEqual([]);
    await eve.screenshot({
      path: ".local/research-workflow.png",
      fullPage: true,
    });
  } finally {
    await bobContext.close();
    await eveContext.close();
  }
});
