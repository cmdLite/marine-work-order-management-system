/**
 * Screenshots the shipped UI at three viewport widths with the Supabase
 * directory calls stubbed, so layout and the Identity Bar can be eyeballed
 * without a live project. Development aid — not part of the app.
 *
 *   node scripts/visual-check.mjs   (with `next start -p 3111` running)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3111";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const VESSELS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "MV Northern Star" },
  { id: "22222222-2222-2222-2222-222222222222", name: "MV Coral Dawn" },
  { id: "33333333-3333-3333-3333-333333333333", name: "Harbour Tender Pelican" },
];

const MEMBERS = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Inés Okonkwo", role: "admin" },
  { id: "aaaaaaaa-0000-0000-0000-000000000002", name: "Dmitri Halvorsen", role: "admin" },
  { id: "bbbbbbbb-0000-0000-0000-000000000001", name: "Capt. Ana Mora", role: "captain" },
  { id: "cccccccc-0000-0000-0000-000000000001", name: "Miguel Santos", role: "crew" },
  { id: "cccccccc-0000-0000-0000-000000000002", name: "Funke Adeyemi", role: "crew" },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch();
const errors = [];

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 2,
  });

  // Playwright matches the most recently registered handler first, so the
  // catch-all goes on before the specific stubs.
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ status: 400, json: { error: "stubbed" } }),
  );
  await context.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  await context.route("**/rest/v1/rpc/identity_vessels", (route) =>
    route.fulfill({ json: VESSELS }),
  );
  await context.route("**/rest/v1/rpc/identity_members", (route) =>
    route.fulfill({ json: MEMBERS }),
  );

  const page = await context.newPage();
  page.on("pageerror", (error) =>
    errors.push(`[${viewport.name}] ${error.message}`),
  );

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${viewport.name}-landing.png`, fullPage: true });

  // Open the member dropdown to prove the dependent selects populated.
  const memberTrigger = page.getByLabel("Member");
  if (await memberTrigger.isVisible()) {
    await memberTrigger.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${viewport.name}-member-picker.png` });
    await page.keyboard.press("Escape");
  }

  await context.close();
}

await browser.close();

if (errors.length > 0) {
  console.error("Runtime errors:\n" + errors.join("\n"));
  process.exit(1);
}
console.log(`Screenshots written to ${OUT}/`);
