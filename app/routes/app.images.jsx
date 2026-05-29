import { useState, useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStoreSettings, saveStoreSettings } from "../lib/settings.server";
import { fetchProductImages, updateImageAlt } from "../lib/images.server";

export function validateTemplate(template) {
  const variableRegex = /#([^#]+)#/g;
  let match;
  const forbiddenChars = ['(', ')', '[', ']', '/', '\\', '`', "'", '|', ';', ':'];

  while ((match = variableRegex.exec(template)) !== null) {
    const varName = match[1];
    const hasForbidden = forbiddenChars.some(char => varName.includes(char));
    if (hasForbidden) {
      return {
        valid: false,
        error: `Variable name "#${varName}#" contains forbidden characters. Do not use ( ) [ ] / \\ \` ' | ; : inside variable names.`,
      };
    }
  }
  return { valid: true };
}

export function truncateFilename(filename, maxLen = 22) {
  if (!filename || filename.length <= maxLen) return filename;
  const extIndex = filename.lastIndexOf('.');
  const ext = extIndex !== -1 ? filename.substring(extIndex) : '';
  const base = extIndex !== -1 ? filename.substring(0, extIndex) : filename;
  const remainLen = maxLen - ext.length - 3; // 3 for '...'
  if (remainLen <= 0) return filename.substring(0, maxLen);
  return `${base.substring(0, Math.ceil(remainLen / 2))}...${base.substring(base.length - Math.floor(remainLen / 2))}${ext}`;
}

export function isPoorFilename(filename) {
  if (!filename) return false;
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
  const isGeneric = /^(img|dsc|photo|pic|image|untitled|download|screenshot|screen_shot|asset|file)[_-\d]*$/i.test(nameWithoutExt)
    || /^\d+$/.test(nameWithoutExt)
    || nameWithoutExt.length < 5;
  return isGeneric;
}

// Client-side template helpers (mirrors images.server.js logic — no server deps)
export function clientGenerateFromTemplate(template, data) {
  if (!template) return "";
  const replacements = {
    "#product_name#": data.productName || "",
    "#product_type#": data.productType || "",
    "#product_vendor#": data.productVendor || "",
    "#shop_name#": data.shopName || "",
    "#variant_sku#": data.sku || "",
    "#variant_barcode#": data.barcode || "",
  };
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(key).join(value);
  }
  result = result.replace(/#[^#]+#/g, "");
  result = result.replace(/\s+/g, " ").trim();
  return result;
}

export function clientGenerateFilename(template, data, originalUrl) {
  const raw = clientGenerateFromTemplate(template, data);
  let cleanName = raw
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();
  let ext = "jpg";
  if (originalUrl) {
    const pathPart = originalUrl.split("?")[0];
    const match = pathPart.match(/\.([a-zA-Z0-9]+)$/);
    if (match) ext = match[1].toLowerCase();
  }
  return `${cleanName}.${ext}`;
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = getStoreSettings(session.shop);
  const { images, shopName } = await fetchProductImages(admin, 50, settings);

  return {
    shop: session.shop,
    shopName,
    settings,
    images,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save-settings") {
    const altTemplate = formData.get("altTemplate");
    const filenameTemplate = formData.get("filenameTemplate");

    // Validate
    const altVal = validateTemplate(altTemplate);
    const fileVal = validateTemplate(filenameTemplate);

    if (!altVal.valid) return { ok: false, message: altVal.error };
    if (!fileVal.valid) return { ok: false, message: fileVal.error };

    saveStoreSettings(session.shop, { altTemplate, filenameTemplate });

    // Re-fetch images with the new templates so the table updates immediately
    try {
      const newSettings = getStoreSettings(session.shop);
      const { images } = await fetchProductImages(admin, 100, newSettings);
      return { ok: true, message: "Templates saved. Suggestions updated.", images, settingsUpdated: true };
    } catch (err) {
      return { ok: true, message: "Templates saved. Re-scan to see updated suggestions." };
    }
  }

  if (intent === "fix-single") {
    const productId = formData.get("productId");
    const mediaId = formData.get("mediaId");
    const altText = formData.get("altText");

    try {
      await updateImageAlt(admin, productId, mediaId, altText);
      return { ok: true, message: "Image description updated on Shopify." };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  if (intent === "fix-bulk") {
    const imagesToUpdate = JSON.parse(formData.get("imagesJson") || "[]");
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const img of imagesToUpdate) {
      try {
        await updateImageAlt(admin, img.productId, img.mediaId, img.suggestedAlt);
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`${img.productName}: ${err.message}`);
      }
    }

    const message = `Bulk update complete. Successfully updated ${successCount} image description(s).` +
      (failCount > 0 ? ` Failed: ${failCount}. Details: ${errors.slice(0, 3).join("; ")}` : "");

    return { ok: true, message };
  }

  if (intent === "scan-all") {
    try {
      const settings = getStoreSettings(session.shop);
      const { images } = await fetchProductImages(admin, 100, settings);
      return { ok: true, message: "Successfully scanned all product images.", images };
    } catch (err) {
      return { ok: false, message: `Scan failed: ${err.message}` };
    }
  }

  return { ok: true };
};

export default function ProductImageOptimisation() {
  const { settings, images: initialImages, shopName } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [imagesList, setImagesList] = useState(initialImages);
  const [altTemplate, setAltTemplate] = useState(settings.altTemplate);
  const [filenameTemplate, setFilenameTemplate] = useState(settings.filenameTemplate);
  const [altError, setAltError] = useState("");
  const [fileError, setFileError] = useState("");
  const [filterMissing, setFilterMissing] = useState(false);
  const [selectedImages, setSelectedImages] = useState({});

  // states for progressive workflow
  const [scanState, setScanState] = useState('idle'); // 'idle' | 'scanning' | 'completed'
  const [scanType, setScanType] = useState(null); // 'all' | 'selected' | 'missing'
  const [showTable, setShowTable] = useState(false);
  const [progress, setProgress] = useState(0);


  // Inline status banner — replaces rapid right-side toasts
  const [statusBanner, setStatusBanner] = useState(null); // { type: 'success'|'error', msg: string }

  const showBanner = (type, msg) => {
    setStatusBanner({ type, msg });
    // Auto-dismiss after 4 seconds
    setTimeout(() => setStatusBanner(null), 4000);
  };

  const isWorking = ["loading", "submitting"].includes(fetcher.state);

  // Sync images list from loader when loader data changes, but not while a mutation is in progress
  useEffect(() => {
    if (isWorking) return;
    setImagesList(initialImages);
  }, [initialImages, isWorking]);

  // When fetcher returns scan data, update images list and complete the scan
  useEffect(() => {
    if (fetcher.data?.images && fetcher.data?.ok) {
      setImagesList(fetcher.data.images);
      setScanState('completed');
      setProgress(100);
      setShowTable(true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Live validation
  useEffect(() => {
    const val = validateTemplate(altTemplate);
    setAltError(val.valid ? "" : val.error);
  }, [altTemplate]);

  useEffect(() => {
    const val = validateTemplate(filenameTemplate);
    setFileError(val.valid ? "" : val.error);
  }, [filenameTemplate]);

  // Live-recompute suggestions in the table whenever templates change
  // This makes the table a live preview of the current template settings
  useEffect(() => {
    if (!imagesList || imagesList.length === 0) return;
    setImagesList(prev => prev.map(img => ({
      ...img,
      suggestedAlt: clientGenerateFromTemplate(altTemplate, {
        productName: img.productName,
        productType: img.productType,
        productVendor: img.productVendor,
        shopName: shopName || "",
        sku: img.sku || "",
        barcode: img.barcode || "",
      }),
      suggestedFilename: clientGenerateFilename(filenameTemplate, {
        productName: img.productName,
        productType: img.productType,
        productVendor: img.productVendor,
        shopName: shopName || "",
        sku: img.sku || "",
        barcode: img.barcode || "",
      }, img.imageUrl),
    })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [altTemplate, filenameTemplate]);

  // Inline banner feedback for fix/save operations (replaces rapid right-side toasts)
  useEffect(() => {
    if (!fetcher.data?.message) return;
    const data = fetcher.data;
    const msg = data.message;
    if (data.ok) {
      if (data.settingsUpdated) {
        showBanner('success', 'Templates saved — suggestions updated below.');
        if (data.images) {
          setImagesList(data.images);
          if (scanState !== 'completed') {
            setScanState('completed');
            setProgress(100);
            setShowTable(true);
          }
        }
      } else if (msg.includes("scanned") || msg.includes("Successfully scanned") || (data.images && !data.settingsUpdated)) {
        // scan — handled in the scan effect above, no extra feedback needed
      } else if (msg.includes("Bulk update complete") || msg.includes("updated on Shopify")) {
        // Show calm inline banner instead of modal popup
        showBanner('success', `✓ ${msg}`);
      }
    } else {
      showBanner('error', msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

  // Progress animation for scanning (purely visual)
  useEffect(() => {
    let timer;
    if (scanState === 'scanning') {
      setProgress(0);
      timer = setInterval(() => {
        setProgress(prev => {
          // Cap at 90% visually — completion driven by server response
          if (prev >= 90) return 90;
          return prev + 3;
        });
      }, 80);
    }
    return () => clearInterval(timer);
  }, [scanState]);

  const saveSettings = () => {
    if (altError || fileError) {
      shopify.toast.show("Please fix validation errors first.");
      return;
    }
    fetcher.submit({ intent: "save-settings", altTemplate, filenameTemplate }, { method: "POST" });
  };

  const applySingle = (img) => {
    // Optimistically update the item immediately (instant feedback)
    setImagesList(prev => prev.map(item => {
      if (item.mediaId === img.mediaId) {
        return {
          ...item,
          currentAlt: img.suggestedAlt,
          hasAlt: true,
          status: "Optimized"
        };
      }
      return item;
    }));

    fetcher.submit({
      intent: "fix-single",
      productId: img.productId,
      mediaId: img.mediaId,
      altText: img.suggestedAlt
    }, { method: "POST" });
  };

  const applyBulk = (imageList) => {
    const targets = imageList.filter(img => !img.hasAlt || selectedImages[img.mediaId]);
    if (targets.length === 0) {
      showBanner('error', 'No images selected or all already have alt text.');
      return;
    }

    // Optimistically update all targets immediately
    const targetMediaIds = new Set(targets.map(t => t.mediaId));
    setImagesList(prev => prev.map(item => {
      if (targetMediaIds.has(item.mediaId)) {
        return {
          ...item,
          currentAlt: item.suggestedAlt,
          hasAlt: true,
          status: "Optimized"
        };
      }
      return item;
    }));
    setSelectedImages({});

    fetcher.submit({
      intent: "fix-bulk",
      imagesJson: JSON.stringify(targets)
    }, { method: "POST" });
  };

  const handleScanAll = () => {
    setScanType('all');
    setScanState('scanning');
    setProgress(0);
    fetcher.submit({ intent: "scan-all" }, { method: "POST" });
  };

  const handleScanMissing = () => {
    setScanType('missing');
    setScanState('scanning');
    setProgress(0);
    fetcher.submit({ intent: "scan-all" }, { method: "POST" });
  };



  // calculations
  const getDisplayResults = () => {
    let list = imagesList;
    if (scanType === 'missing') {
      list = imagesList.filter(img => !img.hasAlt);
    }

    const totalScanned = list.length;
    const missingAlt = list.filter(img => !img.hasAlt).length;
    const readyToFix = missingAlt;
    const optimized = totalScanned - missingAlt;

    // Poor filenames calculation
    const poorFilenamesCount = list.filter(img => {
      const filename = img.imageUrl ? img.imageUrl.split('/').pop().split('?')[0].toLowerCase() : "";
      const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;
      const isGeneric = /^(img|dsc|photo|pic|image|untitled|download|screenshot|screen_shot|asset|file)[_-\d]*$/i.test(nameWithoutExt)
        || /^\d+$/.test(nameWithoutExt)
        || nameWithoutExt.length < 5;
      return isGeneric;
    }).length;

    // Duplicate ALT calculation
    const altCounts = {};
    list.forEach(img => {
      const alt = (img.currentAlt || "").trim().toLowerCase();
      if (alt) {
        altCounts[alt] = (altCounts[alt] || 0) + 1;
      }
    });
    let duplicateAltCount = 0;
    Object.values(altCounts).forEach(count => {
      if (count > 1) {
        duplicateAltCount += (count - 1);
      }
    });

    return {
      list,
      totalScanned,
      missingAlt,
      readyToFix,
      optimized,
      poorFilenames: poorFilenamesCount,
      duplicateAlts: duplicateAltCount,
    };
  };

  const currentResults = getDisplayResults();

  const handleFixAll = () => {
    const listToFix = currentResults.list.filter(img => !img.hasAlt);
    applyBulk(listToFix);
  };

  const handleFixSelected = () => {
    const listToFix = currentResults.list.filter(img => selectedImages[img.mediaId]);
    applyBulk(listToFix);
  };

  const toggleSelectImage = (mediaId) => {
    setSelectedImages(prev => ({
      ...prev,
      [mediaId]: !prev[mediaId]
    }));
  };

  const toggleSelectAll = () => {
    const visibleList = currentResults.list.filter(img => !filterMissing || !img.hasAlt);
    const allSelected = visibleList.every(img => selectedImages[img.mediaId]);
    const nextState = {};
    if (!allSelected) {
      visibleList.forEach(img => {
        nextState[img.mediaId] = true;
      });
    }
    setSelectedImages(nextState);
  };

  const getProgressMessage = (percent) => {
    if (percent < 25) return "Auditing image catalog assets...";
    if (percent < 50) return "Validating descriptions...";
    if (percent < 75) return "Checking image filenames...";
    return "Generating SEO recommendations...";
  };

  return (
    <s-page heading="Product Image Optimisation">
      <div className="llm-page llm-fade-in">
        
        {/* Settings panel — always open */}
        <div className="llm-card" style={{ marginBottom: "24px" }}>
          <div className="llm-card-head">
            <h2>Image Description &amp; Asset Filename Templates</h2>
            <p>Define rules for auto-generating missing image descriptions and suggested asset filenames.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
            <div>
              <label htmlFor="alt-template-input" style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Image Description Template
              </label>
              <input
                id="alt-template-input"
                className="llm-input"
                value={altTemplate}
                onChange={(e) => setAltTemplate(e.target.value)}
                placeholder="#product_name# - #product_type#"
              />
              {altError && <div style={{ color: "var(--llm-error)", fontSize: 11, marginTop: 4 }}>{altError}</div>}
              <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "var(--llm-outline)" }}>Presets:</span>
                {[
                  { label: "Product Name Only", value: "#product_name#" },
                  { label: "Name & Category", value: "#product_name# - #product_type#" },
                  { label: "Name & Brand", value: "#product_name# by #product_vendor#" },
                ].map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className="llm-btn llm-btn-outline llm-btn-sm"
                    style={{ fontSize: "10.5px", height: "22px", padding: "0 8px", fontWeight: "normal" }}
                    onClick={() => setAltTemplate(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="filename-template-input" style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Image Asset Filename Template
              </label>
              <input
                id="filename-template-input"
                className="llm-input"
                value={filenameTemplate}
                onChange={(e) => setFilenameTemplate(e.target.value)}
                placeholder="#product_name# - #product_vendor#"
              />
              {fileError && <div style={{ color: "var(--llm-error)", fontSize: 11, marginTop: 4 }}>{fileError}</div>}
              <div style={{ display: "flex", gap: "6px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "11px", color: "var(--llm-outline)" }}>Presets:</span>
                {[
                  { label: "Product Name Only", value: "#product_name#" },
                  { label: "Name & Brand", value: "#product_name#-#product_vendor#" },
                  { label: "SKU Only", value: "#variant_sku#" },
                ].map(preset => (
                  <button
                    key={preset.label}
                    type="button"
                    className="llm-btn llm-btn-outline llm-btn-sm"
                    style={{ fontSize: "10.5px", height: "22px", padding: "0 8px", fontWeight: "normal" }}
                    onClick={() => setFilenameTemplate(preset.value)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ background: "var(--llm-surface)", borderRadius: "6px", padding: "12px", fontSize: "12px", marginBottom: "12px" }}>
            <strong style={{ display: "block", marginBottom: "4px" }}>Allowed Variables:</strong>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {["#product_name#", "#product_type#", "#product_vendor#", "#shop_name#", "#variant_sku#", "#variant_barcode#"].map(v => (
                <code key={v} style={{ background: "white", padding: "2px 6px", borderRadius: "4px", border: "1px solid var(--llm-card-border)" }}>
                  {v}
                </code>
              ))}
            </div>
          </div>

          <button className="llm-btn llm-btn-primary" onClick={saveSettings} disabled={isWorking}>
            {isWorking ? "Saving…" : "Save Templates"}
          </button>
        </div>

        {/* 3-card action selector — always visible */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
          {[
            {
              id: "scan-all",
              label: "All product images",
              onOptimize: handleScanAll,
              screenItems: [
                { x: 18, y: 14, w: 22, h: 16, color: "#e8eaf6", imgColor: "#9fa8da" },
                { x: 44, y: 14, w: 22, h: 16, color: "#e8eaf6", imgColor: "#7986cb" },
                { x: 18, y: 34, w: 22, h: 16, color: "#e8eaf6", imgColor: "#5c6bc0" },
                { x: 44, y: 34, w: 22, h: 16, color: "#e8eaf6", imgColor: "#9fa8da" },
              ],
              dots: ["#4caf50","#4caf50","#4caf50","#4caf50"],
            },
            {
              id: "scan-select",
              label: "Select product images",
              onOptimize: handleScanAll,
              screenItems: [
                { x: 18, y: 14, w: 22, h: 16, color: "#e3f2fd", imgColor: "#64b5f6", selected: true },
                { x: 44, y: 14, w: 22, h: 16, color: "#e8eaf6", imgColor: "#9fa8da", selected: false },
                { x: 18, y: 34, w: 22, h: 16, color: "#e3f2fd", imgColor: "#42a5f5", selected: true },
                { x: 44, y: 34, w: 22, h: 16, color: "#e8eaf6", imgColor: "#7986cb", selected: false },
              ],
              dots: ["#4caf50","#9e9e9e","#4caf50","#9e9e9e"],
            },
            {
              id: "scan-missing",
              label: "Product images with no ALT text",
              onOptimize: handleScanMissing,
              screenItems: [
                { x: 18, y: 14, w: 22, h: 16, color: "#fff3e0", imgColor: "#ffb74d", warn: true },
                { x: 44, y: 14, w: 22, h: 16, color: "#e8eaf6", imgColor: "#9fa8da" },
                { x: 18, y: 34, w: 22, h: 16, color: "#fff3e0", imgColor: "#ffa726", warn: true },
                { x: 44, y: 34, w: 22, h: 16, color: "#e8eaf6", imgColor: "#7986cb" },
              ],
              dots: ["#ff9800","#4caf50","#ff9800","#4caf50"],
            },
          ].map((card) => {
            const isActive = scanState !== 'idle' &&
              ((card.id === 'scan-missing' && scanType === 'missing') ||
               (card.id !== 'scan-missing' && scanType !== 'missing'));
            const isScanning = isActive && scanState === 'scanning';
            const isDone = isActive && scanState === 'completed';
            return (
              <div
                key={card.id}
                style={{
                  background: isDone ? "#f0f4ff" : "#fff",
                  border: isActive ? "2px solid #5c6ac4" : "1px solid #e5e7eb",
                  borderRadius: "12px",
                  padding: "28px 20px 20px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "12px",
                  boxShadow: isActive ? "0 4px 18px rgba(92,106,196,0.18)" : "0 2px 8px rgba(0,0,0,0.06)",
                  transition: "all 0.2s",
                  position: "relative",
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.boxShadow = "0 4px 18px rgba(92,106,196,0.13)"; }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; }}
              >
                {/* Active indicator pill */}
                {isScanning && (
                  <div style={{ position: "absolute", top: 10, right: 12, background: "#5c6ac4", color: "white", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px", letterSpacing: "0.04em" }}>
                    Scanning…
                  </div>
                )}
                {isDone && (
                  <div style={{ position: "absolute", top: 10, right: 12, background: "#22c55e", color: "white", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px" }}>
                    ✓ Done
                  </div>
                )}

                {/* Monitor illustration */}
                <svg width="160" height="120" viewBox="0 0 160 120" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: isScanning ? 0.7 : 1, transition: "opacity 0.3s" }}>
                  <rect x="10" y="8" width="140" height="88" rx="8" fill="#3c4ab0" />
                  <rect x="10" y="8" width="140" height="88" rx="8" fill="url(#monGrad)" />
                  <rect x="18" y="16" width="124" height="72" rx="4" fill="#1a237e" />
                  <rect x="22" y="20" width="116" height="64" rx="3" fill="#f5f5f5" />
                  <rect x="22" y="20" width="116" height="10" rx="3" fill="#e8eaf6" />
                  <circle cx="28" cy="25" r="2.5" fill="#ef5350" />
                  <circle cx="34" cy="25" r="2.5" fill="#ffc107" />
                  <circle cx="40" cy="25" r="2.5" fill="#4caf50" />
                  {card.screenItems.map((item, i) => (
                    <g key={i}>
                      <rect x={item.x + 22} y={item.y + 20} width={item.w} height={item.h} rx="2" fill={item.color} stroke={item.selected ? "#5c6ac4" : "none"} strokeWidth={item.selected ? "1.5" : "0"} />
                      <rect x={item.x + 25} y={item.y + 23} width={item.w - 6} height={item.h - 8} rx="1.5" fill={item.imgColor} opacity="0.7" />
                      {item.warn ? (
                        <circle cx={item.x + 22 + item.w - 3} cy={item.y + 20 + 3} r="3" fill="#ff9800" />
                      ) : item.selected ? (
                        <circle cx={item.x + 22 + item.w - 3} cy={item.y + 20 + 3} r="3" fill="#5c6ac4" />
                      ) : (
                        <circle cx={item.x + 22 + item.w - 3} cy={item.y + 20 + 3} r="3" fill={card.dots[i]} />
                      )}
                    </g>
                  ))}
                  <rect x="70" y="96" width="20" height="12" rx="2" fill="#3949ab" />
                  <rect x="55" y="106" width="50" height="6" rx="3" fill="#3949ab" />
                  <defs>
                    <linearGradient id={`monGrad-${card.id}`} x1="10" y1="8" x2="150" y2="96" gradientUnits="userSpaceOnUse">
                      <stop stopColor="#5c6ac4" />
                      <stop offset="1" stopColor="#3c4ab0" />
                    </linearGradient>
                  </defs>
                </svg>

                {/* Inline progress bar when scanning this card */}
                {isScanning && (
                  <div style={{ width: "100%" }}>
                    <div style={{ height: "4px", background: "#e0e0e0", borderRadius: "2px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress}%`, background: "linear-gradient(90deg, #5c6ac4, #7c3aed)", borderRadius: "2px", transition: "width 0.15s" }} />
                    </div>
                    <p style={{ fontSize: "11px", color: "#5c6ac4", margin: "4px 0 0", textAlign: "center", fontStyle: "italic" }}>{getProgressMessage(progress)}</p>
                  </div>
                )}

                {/* Label */}
                <p style={{ fontSize: "14px", fontWeight: "500", color: "#111827", textAlign: "center", margin: 0, lineHeight: "1.4" }}>
                  {card.label}
                </p>

                {/* Optimize button */}
                <button
                  style={{
                    width: "100%",
                    padding: "10px 0",
                    background: isDone ? "#5c6ac4" : "#1a1a2e",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "14px",
                    fontWeight: "600",
                    cursor: isWorking ? "not-allowed" : "pointer",
                    opacity: isWorking && !isActive ? 0.5 : 1,
                    transition: "background 0.2s",
                  }}
                  onMouseEnter={e => { if (!isWorking) e.currentTarget.style.background = isDone ? "#4a58a8" : "#2d2b55"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = isDone ? "#5c6ac4" : "#1a1a2e"; }}
                  onClick={card.onOptimize}
                  disabled={isWorking}
                >
                  {isScanning ? "Scanning…" : isDone ? "Re-scan" : "Optimize"}
                </button>
              </div>
            );
          })}
        </div>

        {/* Inline status banner — appears above results, no toast shuffling */}
        {statusBanner && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 18px",
            borderRadius: 10,
            background: statusBanner.type === 'success' ? "#f0fdf4" : "#fef2f2",
            border: `1px solid ${statusBanner.type === 'success' ? "#bbf7d0" : "#fecaca"}`,
            color: statusBanner.type === 'success' ? "#15803d" : "#dc2626",
            fontSize: 13,
            fontWeight: 600,
            animation: "logFadeIn 0.3s ease-out",
          }}>
            <span style={{ fontSize: 18 }}>{statusBanner.type === 'success' ? '✓' : '✕'}</span>
            {statusBanner.msg}
            <button
              onClick={() => setStatusBanner(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "inherit", opacity: 0.6, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        )}

        {/* STEP 3 & 4: View summary & Fix issues */}
        {scanState === 'completed' && (
          <div style={{ animation: "logFadeIn 0.3s ease-out" }}>
            <div className="llm-metric-grid" style={{ marginBottom: "20px" }}>
              <div className="llm-metric">
                <div className="llm-metric-label">Images Scanned</div>
                <div className="llm-metric-value">{currentResults.totalScanned}</div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">Missing Descriptions</div>
                <div className={`llm-metric-value ${currentResults.missingAlt > 0 ? "warning" : "success"}`}>
                  {currentResults.missingAlt}
                </div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">Ready to Optimize</div>
                <div className={`llm-metric-value ${currentResults.readyToFix > 0 ? "warning" : "success"}`}>
                  {currentResults.readyToFix}
                </div>
              </div>
              <div className="llm-metric">
                <div className="llm-metric-label">Already Optimized</div>
                <div className="llm-metric-value success">{currentResults.optimized}</div>
              </div>
            </div>

            {/* Opportunities Found Box */}
            <div className="llm-issues-box">
              <h3>🎯 Content Quality Opportunities</h3>
              <p style={{ fontSize: "13px", color: "var(--llm-on-surface-variant)", margin: "0 0 12px 0" }}>
                {"Relax. We found opportunities that may help AI systems better understand your products. Applying these optimized labels takes less than 2 minutes. We'll guide you through each step."}
              </p>
              <ul className="llm-issues-list" style={{ marginBottom: "16px" }}>
                <li>{currentResults.missingAlt} images missing descriptive alt labels</li>
                <li>{currentResults.poorFilenames} images have generic/non-descriptive asset filenames</li>
                <li>{currentResults.duplicateAlts} images share duplicate description tags</li>
              </ul>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="llm-btn llm-btn-primary"
                  onClick={handleFixAll}
                  disabled={isWorking || currentResults.missingAlt === 0}
                >
                  {isWorking ? "Optimizing..." : "Optimize All"}
                </button>
                <button
                  className="llm-btn llm-btn-outline"
                  onClick={() => setShowTable(!showTable)}
                >
                  {showTable ? "Hide Details" : "Review Results"}
                </button>
              </div>
            </div>

            {/* STEP 5: Review details */}
            {showTable && (
              <div className="llm-card" style={{ animation: "logFadeIn 0.3s ease-out" }}>
                <div className="llm-card-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px", paddingBottom: "12px", borderBottom: "1px solid var(--llm-card-border)" }}>
                  <div>
                    <h2>Scanned Images Details</h2>
                    <p>Review suggested metadata adjustments before pushing to Shopify.</p>
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginLeft: "auto", flexWrap: "wrap" }}>
                    <button
                      className={`llm-btn ${filterMissing ? "llm-btn-primary" : "llm-btn-outline"} llm-btn-sm`}
                      onClick={() => setFilterMissing(!filterMissing)}
                    >
                      {filterMissing ? "Showing: Missing Only" : "Filter: Missing Description"}
                    </button>
                    <button
                      className="llm-btn llm-btn-primary llm-btn-sm"
                      onClick={handleFixSelected}
                      disabled={isWorking || Object.keys(selectedImages).filter(k => selectedImages[k]).length === 0}
                    >
                      Optimize Selected ({Object.keys(selectedImages).filter(k => selectedImages[k]).length})
                    </button>
                  </div>
                </div>

                {currentResults.list.filter(img => !filterMissing || !img.hasAlt).length === 0 ? (
                  <div style={{ padding: "40px 0", textAlign: "center", color: "var(--llm-on-surface-variant)" }}>
                    <p style={{ fontSize: "14px", fontWeight: "600", margin: "0 0 4px 0" }}>No matching images found</p>
                    <p style={{ fontSize: "12.5px", margin: 0 }}>All scanned images match your template settings.</p>
                  </div>
                ) : (
                  <div className="llm-table-wrap">
                    <table className="llm-table">
                      <thead>
                        <tr>
                          <th style={{ width: "30px", paddingRight: 0 }}>
                            <input
                              type="checkbox"
                              checked={currentResults.list.filter(img => !filterMissing || !img.hasAlt).length > 0 && currentResults.list.filter(img => !filterMissing || !img.hasAlt).every(img => selectedImages[img.mediaId])}
                              onChange={toggleSelectAll}
                            />
                          </th>
                          <th style={{ width: "60px" }}>Image</th>
                          <th>Product</th>
                          <th>Image Alt Text</th>
                          <th>Image Asset Filename</th>
                          <th>AI Recommendation</th>
                          <th>Status</th>
                          <th style={{ textAlign: "right" }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentResults.list
                          .filter(img => !filterMissing || !img.hasAlt)
                          .map((img) => {
                            const currentFn = img.imageUrl ? img.imageUrl.split('/').pop().split('?')[0] : "None";
                            const poorFn = isPoorFilename(currentFn);
                            return (
                              <tr key={img.mediaId}>
                                <td style={{ paddingRight: 0, verticalAlign: "middle" }}>
                                  <input
                                    type="checkbox"
                                    checked={!!selectedImages[img.mediaId]}
                                    onChange={() => toggleSelectImage(img.mediaId)}
                                  />
                                </td>
                                <td style={{ verticalAlign: "middle" }}>
                                  {img.imageUrl ? (
                                    <img
                                      src={img.imageUrl}
                                      alt=""
                                      width="50"
                                      height="50"
                                      style={{ borderRadius: "6px", objectFit: "cover", border: "1px solid var(--llm-card-border)" }}
                                    />
                                  ) : (
                                    <span style={{ fontSize: "11px", color: "var(--llm-outline)" }}>No Image</span>
                                  )}
                                </td>
                                <td style={{ verticalAlign: "middle" }}>
                                  <div style={{ fontSize: "13px", fontWeight: "700", lineHeight: "1.3" }}>{img.productName}</div>
                                </td>
                                <td style={{ verticalAlign: "middle" }}>
                                  <span style={{ fontSize: "12px", color: img.hasAlt ? "inherit" : "var(--llm-outline)", fontStyle: img.hasAlt ? "normal" : "italic" }}>
                                    {img.currentAlt || "Missing Label"}
                                  </span>
                                </td>
                                <td style={{ verticalAlign: "middle" }}>
                                  <div style={{ fontSize: "12px" }}>
                                    <code>{truncateFilename(currentFn, 24)}</code>
                                  </div>
                                  {poorFn && (
                                    <div style={{ fontSize: "10.5px", color: "var(--llm-warning)", marginTop: "2px", fontWeight: "600" }}>
                                      ⚠️ Generic Filename (Tip: rename to <code>{truncateFilename(img.suggestedFilename, 24)}</code> before uploading)
                                    </div>
                                  )}
                                </td>
                                <td style={{ verticalAlign: "middle" }}>
                                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--llm-primary)" }}>
                                    {img.suggestedAlt}
                                  </span>
                                </td>
                                <td style={{ verticalAlign: "middle" }}>
                                  <span className={`llm-badge ${img.hasAlt ? "llm-badge-success" : "llm-badge-warning"}`} style={{ display: "inline-flex", minWidth: "90px", justifyContent: "center" }}>
                                    {img.status === "Optimized" || img.hasAlt ? "AI Ready" : "Unoptimized"}
                                  </span>
                                </td>
                                <td style={{ verticalAlign: "middle", textAlign: "right" }}>
                                  <button
                                    className="llm-btn llm-btn-primary llm-btn-sm"
                                    onClick={() => applySingle(img)}
                                    disabled={isWorking}
                                    style={{ minWidth: "80px" }}
                                  >
                                    {isWorking ? "Syncing..." : "Approve"}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div style={{ marginTop: "14px", fontSize: "12px", color: "var(--llm-on-surface-variant)" }}>
                  💡 <strong>Note on Filenames:</strong> Shopify locks filenames on upload. Suggested filenames are shown as recommendations for your original asset files before you re-upload them to your Shopify catalog.
                </div>
              </div>
            )}
          </div>
        )}
      </div>

    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
export function ErrorBoundary() {
  return boundary.error();
}
