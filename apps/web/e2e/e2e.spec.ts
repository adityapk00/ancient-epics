import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const testAdminPassword = "password";
const translationPath = path.join(repoRoot, "texts", "english-preserve-meter-translation.json");
const bookPath = path.join(repoRoot, "texts", "kesh-temple-hymn.txt");

test.describe("End-to-end admin and reader flow", () => {
  test.describe.configure({ mode: "serial" });
  let fileContents: { book: string; translationJSON: { title: string } & Record<string, unknown> };
  const testBookTitle = `Kesh Temple Hymn ${Date.now()}`;

  test.beforeAll(() => {
    fileContents = {
      book: fs.readFileSync(bookPath, "utf8"),
      translationJSON: JSON.parse(fs.readFileSync(translationPath, "utf8")) as { title: string } & Record<
        string,
        unknown
      >,
    };
  });

  test("Admin flow: Create book, create and import translation, publish", async ({ page }) => {
    // 1. Visit /admin and login
    await page.goto("/admin");
    await page.getByPlaceholder("Enter admin password").fill(testAdminPassword);
    await page.getByRole("button", { name: "Enter Admin" }).click();

    // Verify we reached the admin workspace
    await expect(page.getByRole("heading", { level: 2, name: "Books" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Create New Book" })).toBeVisible();

    // 2. Click Create New Book
    await page.getByRole("button", { name: "Create New Book" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Book Details" })).toBeVisible();

    // 3. Fill Book details
    await page.getByLabel("Title").fill(testBookTitle);
    await page.getByLabel("Author").fill("Enheduanna");

    // In "Paste Source Text"
    await page.getByPlaceholder("Paste the full source text here.").fill(fileContents.book);

    // 4. Load auto-split
    await page.getByRole("button", { name: "Load Auto-Split Into Editor" }).click();

    // Check that we staged chapters. Let's wait for stage blocks to appear
    await expect(page.getByText("chapter split(s) detected")).toBeVisible();

    // 5. Create Book
    // The create book button gets disabled when 'Saving...' -> its label becomes 'Create Book'
    await page.getByRole("button", { name: "Create Book" }).last().click();

    // Wait for redirect to Translations page
    await expect(page.getByRole("heading", { level: 2, name: testBookTitle })).toBeVisible({ timeout: 15000 });

    // 6. Import Translation via JSON
    // Set file to hidden input
    await page.locator('input[type="file"]').setInputFiles(translationPath);

    // Wait for the translation workspace screen to show up
    // It should redirect to Translation Screen "workspace"
    await expect(
      page.getByRole("heading", { level: 3 }).filter({ hasText: fileContents.translationJSON.title }),
    ).toBeVisible({
      timeout: 15000,
    });

    // 7. Validate
    await page.getByRole("button", { name: "Validate Translation" }).click();

    // Validation screen shows "Validation Summary" and "Ready to publish"
    await expect(page.getByText("Ready to publish")).toBeVisible({ timeout: 20000 });

    // 8. Publish Translation
    await page.getByRole("button", { name: "Publish Translation" }).click();

    await expect(page.getByText("Translation published.")).toBeVisible({ timeout: 15000 });
  });

  test("Reader flow: View book, signup, login state preservation, chapter continuation", async ({ page }) => {
    // 1. Visit Reader
    await page.goto("/");

    // Wait for the books stage and the imported book
    await expect(page.getByRole("heading", { level: 2, name: "Books" })).toBeVisible();

    // The book title from the UI
    const bookTitleLocator = page.getByRole("heading", { name: testBookTitle });
    await expect(bookTitleLocator).toBeVisible();

    await page.getByRole("button", { name: "Sign Up" }).click();

    // Fill sign up
    const email = `testuser_${Date.now()}@example.com`;
    const pwd = "readerpassword";
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(pwd);
    await page.getByRole("button", { name: "Sign Up For Free", exact: true }).click();

    await expect(page.getByText(email)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Log Out" }).click();

    // Should see Log In again
    await expect(page.getByRole("button", { name: "Log In" })).toBeVisible();

    // Log In again
    await page.getByRole("button", { name: "Log In" }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(pwd);
    await page.getByRole("button", { name: "Log In", exact: true }).last().click();
    await expect(page.getByText(email)).toBeVisible({ timeout: 10000 });

    // 2. Go to Book
    await page.getByRole("button", { name: testBookTitle }).click();

    // Verify on Book View
    await expect(page.getByRole("heading", { level: 2, name: testBookTitle })).toBeVisible();

    // 3. Click Translation
    // The translation name comes from JSON, e.g. "English (Preserve Meter)"
    const transName = fileContents.translationJSON.title;
    await page.getByRole("button", { name: transName }).click();

    // 4. Verify translation view and content
    await expect(page.getByRole("heading", { level: 3, name: "House 1" })).toBeVisible();

    // Move to the next chapter using the reader controls.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("heading", { level: 3, name: "House 2" })).toBeVisible();

    // 5. Go Back to Main View
    await page.goto("/");

    // 6. Return to Translation
    await page.getByRole("button", { name: testBookTitle }).click();
    await page.getByRole("button", { name: transName }).click();

    await expect(page.getByRole("heading", { level: 3, name: "House 2" })).toBeVisible();
  });
});
