import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";
test("search null outcomes, inspect related knowledge and download permission-checked portable JSON", async ({
  page,
}) => {
  test.setTimeout(120000);
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
  const fixture = await page.evaluate(async () => {
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
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json();
    };
    const ws = await call("/v1/workspaces", {
        name: `Discovery browser ${Date.now()}`,
      }),
      base = `/v1/workspaces/${ws.id}`,
      common = {
        body: "Synthetic reproducible finding",
        language: "en",
        source_refs: [],
      };
    const publish = async (o: any) =>
      call(
        `${base}/objects/${o.id}/publish`,
        { revision: o.revision, confirmation: true },
        o.etag,
      );
    const make = async (type: string, content: any) =>
      publish(
        await call(`${base}/objects`, {
          type,
          schema_version: 1,
          content: { ...common, ...content },
        }),
      );
    const method = await make("method", {
      title: "Sapphire protocol",
      ordered_steps: ["Measure baseline"],
      metrics: ["Temperature"],
      constraints: [],
      ethical_constraints: [],
    });
    const result = await make("result", {
      title: "Sapphire null replication",
      method_ref: { id: method.id, revision: method.revision },
      outcome: "null",
      measurement_context: "No detectable difference",
      artifact_refs: [],
    });
    const a = await call(`${base}/artifacts`, {
      ...common,
      title: "Sapphire specimen",
      kind: "physical",
      license: "Custodian permission required",
      custodian: "Lab",
      location: "Cabinet",
      access_protocol: "Supervised inspection",
      integrity_metadata: "Sample S",
    });
    const artifact = await publish(a.object);
    await call(`${base}/edges`, {
      type: "uses_method",
      from: { id: result.id, revision: result.revision },
      to: { id: method.id, revision: method.revision },
      rationale: "Recorded protocol",
    });
    return {
      workspace: ws.id,
      result: result.id,
      method: method.id,
      artifact: artifact.id,
    };
  });
  await page.reload();
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption(fixture.workspace);
  const discovery = page.getByRole("region", { name: "Search and export" });
  await discovery
    .getByLabel("Search published knowledge", { exact: true })
    .fill("Sapphire");
  await discovery
    .getByRole("combobox", { name: "Result outcome filter", exact: true })
    .selectOption("null");
  await expect(async () => {
    await discovery
      .getByRole("button", { name: "Search knowledge", exact: true })
      .click();
    await expect(
      discovery.getByRole("button", {
        name: "Sapphire null replication",
        exact: true,
      }),
    ).toBeVisible();
  }).toPass({ timeout: 30000, intervals: [1000] });
  await expect(discovery).toContainText("outcome null");
  await discovery
    .getByRole("button", { name: "Sapphire null replication", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Object details" }),
  ).toContainText("No detectable difference");
  await discovery
    .getByRole("button", {
      name: "Add Sapphire null replication to export",
      exact: true,
    })
    .click();
  await discovery
    .getByRole("button", {
      name: "Related to Sapphire null replication",
      exact: true,
    })
    .click();
  await expect(
    discovery.getByRole("button", { name: "Sapphire protocol", exact: true }),
  ).toBeVisible();
  await expect(discovery).toContainText("direct graph relationship");
  await discovery
    .getByRole("button", { name: "Prepare JSON export", exact: true })
    .click();
  await expect(async () => {
    await discovery
      .getByRole("button", { name: "Refresh exports", exact: true })
      .click();
    await expect(
      discovery.getByRole("link", { name: /Download JSON export/ }),
    ).toBeVisible();
  }).toPass({ timeout: 30000, intervals: [1000] });
  const downloaded = page.waitForEvent("download");
  await discovery.getByRole("link", { name: /Download JSON export/ }).click();
  const file = await downloaded;
  await file.saveAs(".local/search-export.json");
  const body = JSON.parse(await readFile(".local/search-export.json", "utf8"));
  expect(body.format).toBe("ideator-json-v1");
  expect(body.objects.map((o: any) => o.id).sort()).toEqual(
    [fixture.method, fixture.result].sort(),
  );
  expect(body.lineage.some((l: any) => l.input_id === fixture.method)).toBe(
    true,
  );
  expect(body.artifact_bytes_included).toBe(false);
  await page
    .getByRole("button", {
      name: /artifact · Workspace published Sapphire specimen/,
    })
    .click();
  await discovery
    .getByText("Usage permission for selected revision", { exact: true })
    .click();
  await discovery
    .getByRole("button", { name: "Load export permission", exact: true })
    .click();
  await expect(discovery).toContainText("Export not permitted");
  await discovery
    .getByRole("combobox", { name: "Metadata export permission", exact: true })
    .selectOption("yes");
  await discovery
    .getByLabel("License or consent decision reason")
    .fill("Custodian permits metadata export under recorded terms");
  await discovery
    .getByRole("button", { name: "Record export permission", exact: true })
    .click();
  await expect(
    discovery.getByRole("log", { name: "Discovery update" }),
  ).toContainText("Export permission recorded");
  await discovery
    .getByRole("button", { name: "Refresh exports", exact: true })
    .click();
  await expect(discovery).toContainText(
    "permissions or content changed; prepare a new export",
  );
  await expect(
    discovery.getByRole("link", { name: /Download JSON export/ }),
  ).toHaveCount(0);
  await discovery.getByText("Search maintenance", { exact: true }).click();
  await discovery
    .getByRole("button", { name: "Rebuild search index", exact: true })
    .click();
  await expect(
    discovery.getByRole("log", { name: "Discovery update" }),
  ).toContainText("Search rebuild queued");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: ".local/discovery.png", fullPage: true });
});
