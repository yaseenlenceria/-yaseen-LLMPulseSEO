/**
 * Broken Link Checker Service
 *
 * TODO: To implement a full live store crawler:
 * 1. Use an HTTP client (like axios or fetch) to fetch the store's HTML index.
 * 2. Parse HTML using a library like cheerio to extract all links (`<a href="...">`).
 * 3. Crawl links recursively within the store domain up to a safe depth (e.g. depth=3) to prevent infinite loops.
 * 4. Perform HEAD or GET requests on each link to check HTTP response status.
 * 5. Track broken links (status >= 400 or network errors) and store them in the database.
 * 6. Use background queues (e.g., bullmq or simple setTimeouts) to handle crawling asynchronously to avoid Gateway timeouts.
 */

export function getMockScanData() {
  const pages = [
    { path: "/", name: "Homepage" },
    { path: "/collections/all", name: "All Products" },
    { path: "/products/air-running-shoes", name: "Air Running Shoes" },
    { path: "/pages/about-us", name: "About Us" },
    { path: "/pages/contact", name: "Contact Us" },
  ];

  const brokenLinks = [
    {
      sourcePage: "/pages/about-us",
      brokenUrl: "/pages/our-team-member-bio-temp",
      statusCode: 404,
      anchorText: "Meet our founders",
      issueType: "Page Not Found (404)",
      suggestedAction: "The linked page has been deleted or moved. Update the link to '/pages/about-us#team' or create the page.",
    },
    {
      sourcePage: "/products/air-running-shoes",
      brokenUrl: "https://external-sizechart-provider.com/shoes-size",
      statusCode: 502,
      anchorText: "View Sizing Guide",
      issueType: "External Link Down (502)",
      suggestedAction: "The external size guide provider is offline. Upload a local sizing image instead, or update the link.",
    },
    {
      sourcePage: "/pages/contact",
      brokenUrl: "mailto:support@llmpulseseo",
      statusCode: 0,
      anchorText: "Email Support",
      issueType: "Malformed URL",
      suggestedAction: "The mailto address is incomplete. Correct it to a valid email format (e.g., 'mailto:support@llmpulseseo.com').",
    },
  ];

  return {
    pagesChecked: pages.length,
    brokenLinksFound: brokenLinks.length,
    lastScanDate: new Date().toISOString(),
    links: brokenLinks,
  };
}

export async function simulateScan(shop) {
  // Simulate network delay of 1.5 seconds for a realistic scanner feel
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log(`[Broken Links] Simulating scan for shop: ${shop}`);

  const results = getMockScanData();
  return results;
}
