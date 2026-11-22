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

test("workspace changes discard late reads and claim retries preserve scientific fields", async ({
  page,
}) => {
  const source = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    target = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    user = "author";
  const atom = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    author_id: user,
    type: "claim",
    origin: "human",
    lifecycle: "draft",
    has_draft: true,
    revision: 1,
    etag: '"1"',
    review_state: "unreviewed",
    validity: "active",
    freshness: "current",
    content: {
      title: "French claim",
      body: "Raisonnement",
      proposition: "Prédiction",
      language: "fr",
      scope: "Essai",
      qualifiers: [],
      source_refs: [],
    },
  };
  let release!: () => void, started!: () => void, delivered!: () => void;
  const wait = new Promise<void>((resolve) => {
      release = resolve;
    }),
    starting = new Promise<void>((resolve) => {
      started = resolve;
    }),
    finished = new Promise<void>((resolve) => {
      delivered = resolve;
    });
  const keys: string[] = [];
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/session")
      return route.fulfill({
        json: {
          user: { id: user, name: "Author" },
          csrf: "token",
          workspaces: [
            { id: source, name: "Source" },
            { id: target, name: "Target" },
          ],
        },
      });
    if (path.endsWith("/projects"))
      return route.fulfill({ json: { items: [] } });
    if (path === `/v1/workspaces/${source}/objects`) {
      started();
      await wait;
      await route.fulfill({
        json: {
          items: [
            {
              ...atom,
              content: { ...atom.content, title: "Old workspace claim" },
            },
          ],
        },
      });
      delivered();
      return;
    }
    if (path.endsWith("/draft")) {
      keys.push(route.request().headers()["idempotency-key"]);
      const payload = route.request().postDataJSON();
      expect(payload.content).toEqual({ ...atom.content, title: "New title" });
      if (keys.length === 1) return route.abort("failed");
      return route.fulfill({ json: { ...atom, content: payload.content } });
    }
    return route.fulfill({
      json: path.endsWith("/objects") ? { items: [atom] } : atom,
    });
  });
  await page.goto("/");
  await starting;
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption(target);
  const card = page.getByRole("button", { name: /French claim/ });
  await expect(card).toBeVisible();
  release();
  await finished;
  await expect(
    page.getByRole("button", { name: /Old workspace claim/ }),
  ).toHaveCount(0);
  await card.click();
  await page.getByRole("button", { name: "Edit draft", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("New title");
  await page.getByLabel("Reason for this revision").fill("Title only");
  const save = page.getByRole("button", { name: "Save private draft" });
  await save.click();
  await expect(page.getByRole("status")).toContainText(/fetch|network/i);
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Private draft saved.");
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("projects and their references have independent continuation cursors", async ({
  page,
}) => {
  const projects = Array.from({ length: 26 }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Project ${i + 1}`,
  }));
  const refs = Array.from({ length: 26 }, (_, i) => ({
    id: `r${i + 1}`,
    content: { title: `Reference ${i + 1}` },
  }));
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/session")
      return route.fulfill({
        json: {
          user: { id: "user", name: "User" },
          workspaces: [{ id: "ws", name: "Workspace" }],
        },
      });
    const isProjects = url.pathname.endsWith("/projects");
    const items = isProjects
      ? projects
      : url.pathname.includes("/projects/")
        ? refs
        : [];
    const next = isProjects ? "p25" : "r25";
    const page2 = url.searchParams.get("cursor") === next;
    return route.fulfill({
      json: {
        items: page2 ? items.slice(25) : items.slice(0, 25),
        next_cursor: items.length > 25 && !page2 ? next : null,
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Load more projects" }).click();
  const card = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Project 26", exact: true }),
  });
  await card.getByRole("button", { name: "View references" }).click();
  await card.getByRole("button", { name: "Load more references" }).click();
  await expect(
    card.getByRole("button", { name: "Reference 26", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Reference 1", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Load more references" }),
  ).toHaveCount(0);
});
