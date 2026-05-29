import fs from "node:fs";
import path from "node:path";

const STORAGE_DIR = path.join(process.cwd(), "storage");

// Ensure storage directory exists
function ensureStorageDir() {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function getFilePath(shop, type) {
  ensureStorageDir();
  // Safe filename from shop domain
  const safeShop = shop.replace(/[^a-zA-Z0-9.-]/g, "_");
  return path.join(STORAGE_DIR, `${safeShop}_${type}.json`);
}

export function getStoreSettings(shop) {
  const filePath = getFilePath(shop, "settings");
  const defaults = {
    altTemplate: "#product_name# - #product_type#",
    filenameTemplate: "#product_name# - #product_vendor#",
    robotsInstalled: false,
    schemaSettings: {
      storeName: "",
      businessType: "OnlineStore",
      email: "",
      phone: "",
      description: "",
      imageUrl: "",
      priceRangeFrom: "",
      priceRangeTo: "",
      workingHours: "",
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      latitude: "",
      longitude: "",
      facebookUrl: "",
      xUrl: "",
      instagramUrl: "",
      linkedInUrl: "",
      pinterestUrl: "",
      injected: false,
    },
  };

  if (!fs.existsSync(filePath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      altTemplate: parsed.altTemplate || defaults.altTemplate,
      filenameTemplate: parsed.filenameTemplate || defaults.filenameTemplate,
      robotsInstalled: parsed.robotsInstalled !== undefined ? parsed.robotsInstalled : defaults.robotsInstalled,
      schemaSettings: {
        ...defaults.schemaSettings,
        ...(parsed.schemaSettings || {}),
      },
    };
  } catch (err) {
    console.error("Error reading settings for shop:", shop, err);
    return defaults;
  }
}

export function saveStoreSettings(shop, settings) {
  const filePath = getFilePath(shop, "settings");
  try {
    const current = getStoreSettings(shop);
    const updated = {
      altTemplate: settings.altTemplate !== undefined ? settings.altTemplate : current.altTemplate,
      filenameTemplate: settings.filenameTemplate !== undefined ? settings.filenameTemplate : current.filenameTemplate,
      robotsInstalled: settings.robotsInstalled !== undefined ? settings.robotsInstalled : current.robotsInstalled,
      schemaSettings: {
        ...current.schemaSettings,
        ...(settings.schemaSettings || {}),
      },
    };
    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf8");
    return updated;
  } catch (err) {
    console.error("Error saving settings for shop:", shop, err);
    throw err;
  }
}

export function getBrokenLinkScan(shop) {
  const filePath = getFilePath(shop, "broken_links");
  const defaults = {
    pagesChecked: 0,
    brokenLinksFound: 0,
    lastScanDate: null,
    links: [],
  };

  if (!fs.existsSync(filePath)) {
    return defaults;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return {
      ...defaults,
      ...JSON.parse(raw),
    };
  } catch (err) {
    console.error("Error reading broken links for shop:", shop, err);
    return defaults;
  }
}

export function saveBrokenLinkScan(shop, scanData) {
  const filePath = getFilePath(shop, "broken_links");
  try {
    fs.writeFileSync(filePath, JSON.stringify(scanData, null, 2), "utf8");
    return scanData;
  } catch (err) {
    console.error("Error saving broken links for shop:", shop, err);
    throw err;
  }
}
