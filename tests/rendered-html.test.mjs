import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the ClipPang dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>ClipPang/);
  assert.match(html, /คลิปพร้อมขาย/);
  assert.match(html, /สร้างคลิปใหม่/);
  assert.match(html, /VOICEOVER/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("removes starter preview artifacts and uses Thai product metadata", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /Dashboard/);
  assert.match(layout, /lang="th"/);
  assert.match(layout, /@fontsource\/kanit/);
  assert.match(layout, /og\.png/);
  assert.doesNotMatch(layout, /Starter Project|codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("../app/_sites-preview/", import.meta.url)));
  await access(new URL("../public/og.png", import.meta.url));
  await access(new URL("../public/clippang-sample.mp4", import.meta.url));
});

test("setup home action bypasses the broken RSC client transition", async () => {
  const setupPage = await readFile(new URL("../app/setup/page.tsx", import.meta.url), "utf8");
  assert.match(setupPage, /window\.location\.assign\("\/"\)/);
  assert.doesNotMatch(setupPage, /from "next\/link"/);
});

test("local app navigation avoids Vinext RSC prefetch transitions", async () => {
  const files = [
    "../app/components/AppShell.tsx",
    "../app/components/Dashboard.tsx",
    "../app/components/ProjectWizard.tsx",
    "../app/styles/page.tsx",
  ];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, import.meta.url), "utf8")));
  for (const source of sources) assert.doesNotMatch(source, /from "next\/link"/);

  const hardLink = await readFile(new URL("../app/components/HardLink.tsx", import.meta.url), "utf8");
  assert.match(hardLink, /return <a href=\{href\}[^>]*>\{children\}<\/a>/);
});

test("Thai project routes are decoded exactly once before API requests", async () => {
  const [wizard, localApi] = await Promise.all([
    readFile(new URL("../app/components/ProjectWizard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/local-api.ts", import.meta.url), "utf8"),
  ]);

  assert.match(wizard, /decodeURIComponent\(rawRouteId\)/);
  assert.match(localApi, /api\/projects\/\$\{encodeURIComponent\(id\)\}/);
});
