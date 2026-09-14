// Normal checkouts use the locked project dependency. An explicit module path
// supports environments that provide a separately managed Playwright install.
let playwright;
try {
  playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
} catch (cause) {
  throw new Error('Run npm ci in the repository root, or set PLAYWRIGHT_MODULE to an installed Playwright module.', { cause });
}
export const { chromium } = playwright;
