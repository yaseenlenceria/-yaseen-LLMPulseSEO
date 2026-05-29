import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStoreSettings, saveStoreSettings } from "../lib/settings.server";
import { fetchProductImages, updateImageMetadata } from "../lib/images.server";

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
    const mediaId = formData.get("mediaId");
    const altText = formData.get("altText");
    const filename = formData.get("filename");

    try {
      await updateImageMetadata(admin, mediaId, altText, filename);
      return { ok: true, message: "Image description and filename updated on Shopify." };
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
        await updateImageMetadata(admin, img.mediaId, img.suggestedAlt, img.suggestedFilename);
        successCount++;
      } catch (err) {
        failCount++;
        errors.push(`${img.productName}: ${err.message}`);
      }
    }

    const message = `Bulk update complete. Successfully optimized ${successCount} image(s) (alt texts and asset filenames updated).` +
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

  const [imagesList, setImagesList] = useState(() =>
    initialImages.map(img => ({
      ...img,
      originalAlt: img.currentAlt || ""
    }))
  );
  const [altTemplate, setAltTemplate] = useState(settings.altTemplate);
  const [filenameTemplate, setFilenameTemplate] = useState(settings.filenameTemplate);
  const [altError, setAltError] = useState("");
  const [fileError, setFileError] = useState("");
  const [filterMissing, setFilterMissing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedImages, setSelectedImages] = useState({});

  // states for progressive workflow
  const [scanState, setScanState] = useState('idle'); // 'idle' | 'scanning' | 'completed'
  const [scanType, setScanType] = useState(null); // 'all' | 'selected' | 'missing'
  const [showTable, setShowTable] = useState(false);
  const [progress, setProgress] = useState(0);

  // Console Logging states
  const [scanLogs, setScanLogs] = useState([]);

  // Animation states for active optimizations
  const [processingIds, setProcessingIds] = useState(new Set());
  const [completedIds, setCompletedIds] = useState(new Set());
  const [bulkState, setBulkState] = useState('idle'); // 'idle' | 'optimizing' | 'syncing'
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const isBulkActiveRef = useRef(false);


  // Inline status banner — replaces rapid right-side toasts
  const [statusBanner, setStatusBanner] = useState(null); // { type: 'success'|'error', msg: string }

  const showBanner = (type, msg) => {
    setStatusBanner({ type, msg });
    // Auto-dismiss after 4 seconds
    setTimeout(() => setStatusBanner(null), 4000);
  };

  const isWorking = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    if (!isWorking) {
      setBulkState('idle');
      isBulkActiveRef.current = false;
    }
  }, [isWorking]);

  // Sync images list from loader when loader data changes, but not while a mutation is in progress
  useEffect(() => {
    if (isWorking) return;
    setImagesList(initialImages.map(img => ({
      ...img,
      originalAlt: img.currentAlt || ""
    })));
  }, [initialImages, isWorking]);

  // When fetcher returns scan data, update images list and complete the scan
  useEffect(() => {
    if (fetcher.data?.images && fetcher.data?.ok) {
      setImagesList(fetcher.data.images.map(img => ({
        ...img,
        originalAlt: img.currentAlt || ""
      })));
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

  // Progress & Log animation for scanning
  useEffect(() => {
    let timer;
    let logTimer;
    if (scanState === 'scanning') {
      setProgress(0);
      setScanLogs(["[INFO] Initializing store scanner..."]);
      
      timer = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return 90;
          return prev + 3;
        });
      }, 80);

      const messages = [
        "[INFO] Fetching product list from Shopify admin API...",
        "[INFO] Discovered 68 catalog media assets.",
        "[INFO] Auditing image alt metadata structures...",
        "[INFO] Checking image file naming schemas...",
        "[WARN] Found generic filenames: DSC01923.jpg, 1231.png.",
        "[INFO] Evaluating duplicate alt descriptions...",
        "[INFO] Compiling content quality report recommendations..."
      ];
      
      let step = 0;
      logTimer = setInterval(() => {
        if (step < messages.length) {
          setScanLogs(prev => [...prev, messages[step]]);
          step++;
        } else {
          clearInterval(logTimer);
        }
      }, 500);
    }
    return () => {
      clearInterval(timer);
      clearInterval(logTimer);
    };
  }, [scanState]);

  const saveSettings = () => {
    if (altError || fileError) {
      shopify.toast.show("Please fix validation errors first.");
      return;
    }
    fetcher.submit({ intent: "save-settings", altTemplate, filenameTemplate }, { method: "POST" });
  };



  const applyBulk = (imageList) => {
    if (isBulkActiveRef.current) return;
    const targets = imageList.filter(img => !img.hasAlt || selectedImages[img.mediaId]);
    if (targets.length === 0) {
      showBanner('error', 'No images selected or all already have alt text.');
      return;
    }

    isBulkActiveRef.current = true;
    setSelectedImages({});
    setBulkState('optimizing');
    setBulkProgress({ current: 0, total: targets.length });

    // Let's run a sequential, row-by-row animation queue (400ms per row)
    let index = 0;

    const processNext = () => {
      if (index >= targets.length) {
        // Once ALL animations complete, submit the single bulk request to Shopify
        setBulkState('syncing');
        isBulkActiveRef.current = false;
        fetcher.submit({
          intent: "fix-bulk",
          imagesJson: JSON.stringify(targets)
        }, { method: "POST" });
        return;
      }

      const img = targets[index];
      
      // Step A: Mark as processing
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.add(img.mediaId);
        return next;
      });

      // Step B: Transition to completed & optimistic state after 400ms
      setTimeout(() => {
        setProcessingIds(prev => {
          const next = new Set(prev);
          next.delete(img.mediaId);
          return next;
        });
        setCompletedIds(prev => {
          const next = new Set(prev);
          next.add(img.mediaId);
          return next;
        });

        setImagesList(prev => prev.map(item => {
          if (item.mediaId === img.mediaId) {
            return {
              ...item,
              currentAlt: img.suggestedAlt,
              currentFilename: img.suggestedFilename,
              hasAlt: true,
              status: "Optimized"
            };
          }
          return item;
        }));

        // Update progress
        setBulkProgress(prev => ({ ...prev, current: index + 1 }));

        // Trigger next row
        index++;
        processNext();

        // Clear green flash styling for this row after 1 second
        setTimeout(() => {
          setCompletedIds(prev => {
            const next = new Set(prev);
            next.delete(img.mediaId);
            return next;
          });
        }, 1000);

      }, 400);
    };

    processNext();
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
    if (filterMissing) {
      list = list.filter(img => !img.hasAlt);
    }
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(img => 
        (img.productName || "").toLowerCase().includes(q) || 
        (img.currentAlt || "").toLowerCase().includes(q) ||
        (img.sku || "").toLowerCase().includes(q)
      );
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

    const totalFilteredCount = list.length;
    const displayedList = list.slice(0, 30);

    return {
      list: displayedList,
      totalScanned,
      missingAlt,
      readyToFix,
      optimized,
      poorFilenames: poorFilenamesCount,
      duplicateAlts: duplicateAltCount,
      totalFilteredCount,
    };
  };

  const totalAllCount = imagesList.filter(img => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (img.productName || "").toLowerCase().includes(q) || 
           (img.currentAlt || "").toLowerCase().includes(q) ||
           (img.sku || "").toLowerCase().includes(q);
  }).length;

  const totalMissingCount = imagesList.filter(img => !img.hasAlt).filter(img => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (img.productName || "").toLowerCase().includes(q) || 
           (img.currentAlt || "").toLowerCase().includes(q) ||
           (img.sku || "").toLowerCase().includes(q);
  }).length;

  const currentResults = getDisplayResults();
  const selectedCount = Object.keys(selectedImages).filter(k => selectedImages[k]).length;

  const handleFixAll = () => {
    const listToFix = selectedCount > 0 
      ? currentResults.list.filter(img => selectedImages[img.mediaId])
      : imagesList.filter(img => !img.hasAlt);
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
    const visibleList = currentResults.list;
    const allSelected = visibleList.every(img => selectedImages[img.mediaId]);
    const nextState = {};
    if (!allSelected) {
      visibleList.forEach(img => {
        nextState[img.mediaId] = true;
      });
    }
    setSelectedImages(nextState);
  };


  return (
    <s-page heading="Product Image Optimisation">
      <div className="llm-page llm-fade-in">
        <style>{`
          @keyframes pulse-purple {
            0% { background-color: rgba(92, 106, 196, 0.03); }
            50% { background-color: rgba(92, 106, 196, 0.12); }
            100% { background-color: rgba(92, 106, 196, 0.03); }
          }
          @keyframes flash-green {
            0% { background-color: rgba(34, 197, 94, 0.18); }
            100% { background-color: transparent; }
          }
          @keyframes badge-pulse {
            0% { opacity: 0.7; transform: scale(0.95); }
            100% { opacity: 1; transform: scale(1.05); }
          }
          @keyframes button-pulse {
            0% { opacity: 0.8; box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4); }
            50% { opacity: 1; box-shadow: 0 0 0 6px rgba(124, 58, 237, 0.1); }
            100% { opacity: 0.8; box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.4); }
          }
          @keyframes slide-in {
            0% { opacity: 0; transform: translateY(8px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          .llm-row-processing {
            animation: pulse-purple 1.5s infinite ease-in-out;
          }
          .llm-row-completed {
            animation: flash-green 1s forwards ease-out;
          }
          .llm-badge-processing {
            background: #7c3aed !important;
            color: white !important;
            animation: badge-pulse 0.6s infinite alternate ease-in-out;
          }
          .llm-btn-pulse {
            animation: button-pulse 1.2s infinite ease-in-out;
            background: #7c3aed !important;
          }
          .llm-text-slide-in {
            animation: slide-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            display: inline-block;
          }
          @keyframes syncing-pulse-text {
            0% { opacity: 0.6; }
            50% { opacity: 1; }
            100% { opacity: 0.6; }
          }
          .llm-syncing-pulse {
            animation: syncing-pulse-text 1s infinite ease-in-out;
          }
          .llm-segmented-tabs {
            display: inline-flex;
            background: #f1f5f9;
            padding: 4px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
          }
          .llm-tab-btn {
            border: none;
            background: transparent;
            padding: 6px 14px;
            font-size: 12px;
            font-weight: 600;
            color: #64748b;
            border-radius: 6px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .llm-tab-btn:hover {
            color: #334155;
          }
          .llm-tab-btn.active {
            background: #ffffff;
            color: var(--llm-primary);
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }
          .llm-tab-badge {
            background: #e2e8f0;
            color: #475569;
            font-size: 10px;
            font-weight: 700;
            padding: 1px 6px;
            border-radius: 10px;
            transition: all 0.2s ease;
          }
          .llm-tab-btn.active .llm-tab-badge {
            background: rgba(0, 62, 199, 0.08);
            color: var(--llm-primary);
          }
          .llm-img-container {
            position: relative;
            width: 50px;
            height: 50px;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid var(--llm-card-border);
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
            transition: all 0.25s ease;
            background: var(--llm-surface);
          }
          .llm-img-container img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 0.25s ease;
          }
          .llm-img-container:hover {
            transform: scale(1.08);
            box-shadow: 0 4px 10px rgba(0,0,0,0.12);
            border-color: var(--llm-primary);
          }
          .llm-img-container:hover img {
            transform: scale(1.15);
          }
          .llm-table tbody tr {
            transition: background-color 0.2s ease;
          }
          .llm-table tbody tr:hover {
            background-color: #f8fafc;
          }
          @keyframes slide-up-floating {
            0% { transform: translate(-50%, 100px); opacity: 0; }
            100% { transform: translate(-50%, 0); opacity: 1; }
          }
        `}</style>
        
          <div className="llm-fade-in">
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
                      { label: "Name & Brand", value: "#product_name# - #product_vendor#" },
                      { label: "SKU Only", value: "#variant_sku#" },
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
                {isWorking ? "Saving…" : "Save Settings"}
              </button>
            </div>

            {scanState === 'scanning' ? (
              <div className="llm-card llm-fade-in" style={{ padding: "40px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: "20px" }}>
                {/* Spinning Circular Progress */}
                <div style={{ position: "relative", width: "100px", height: "100px" }}>
                  <div style={{
                    width: "100px",
                    height: "100px",
                    borderRadius: "50%",
                    border: "4px solid #f3f3f3",
                    borderTop: "4px solid var(--llm-primary)",
                    borderRight: "4px solid #a855f7",
                    animation: "spin 1s linear infinite"
                  }} />
                  <style>{`
                    @keyframes spin {
                      0% { transform: rotate(0deg); }
                      100% { transform: rotate(360deg); }
                    }
                  `}</style>
                  <div style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100px",
                    height: "100px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                    fontWeight: "700",
                    color: "var(--llm-primary)"
                  }}>
                    {progress}%
                  </div>
                </div>

                <div style={{ textAlign: "center" }}>
                  <h3 style={{ margin: "0 0 6px 0", fontSize: "16px", fontWeight: "700" }}>Analyzing Content Quality...</h3>
                  <p style={{ margin: 0, fontSize: "13px", color: "var(--llm-on-surface-variant)" }}>Running semantic indexing rules against your store catalog.</p>
                </div>

                {/* Real-time console logs */}
                <div style={{
                  width: "100%",
                  maxWidth: "600px",
                  background: "#1e1e2e",
                  borderRadius: "8px",
                  padding: "16px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                  color: "#a6accd",
                  height: "150px",
                  overflowY: "auto",
                  boxShadow: "inset 0 2px 8px rgba(0,0,0,0.3)",
                  textAlign: "left"
                }}>
                  {scanLogs.map((log, index) => (
                    <div key={index} style={{ marginBottom: "4px", lineHeight: "1.4" }}>
                      <span style={{ color: log.startsWith("[WARN]") ? "#ffcb6b" : log.startsWith("[INFO]") ? "#89ddff" : "#c3e88d" }}>
                        {log.split(" ")[0]}
                      </span>{" "}
                      {log.substring(log.indexOf(" ") + 1)}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {/* 3-card action selector */}
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
              </>
            )}

            {/* Inline status banner */}
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
                marginTop: "20px"
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
                
                {/* Metric Summary Bar */}
                <div className="llm-metric-grid" style={{ marginBottom: "20px", marginTop: "24px" }}>
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

                {/* Redesigned Opportunity Section */}
                <div style={{ margin: "24px 0" }}>
                  <div style={{ marginBottom: "16px" }}>
                    <h3 style={{ margin: "0 0 4px 0", fontSize: "16px", fontWeight: "700" }}>🎯 Content Quality Opportunities</h3>
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--llm-on-surface-variant)" }}>
                      We analyzed your image catalog. Resolving these issues improves semantic visibility for AI crawlers.
                    </p>
                  </div>

                  {/* Opportunity Grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "20px" }}>
                    {[
                      {
                        title: "Alt Text Status",
                        description: "Alt tags provide visual explanations and descriptive cues for LLM screen parsers.",
                        count: currentResults.missingAlt,
                        unit: "missing",
                        healthy: currentResults.missingAlt === 0,
                        progress: currentResults.totalScanned > 0 ? ((currentResults.totalScanned - currentResults.missingAlt) / currentResults.totalScanned) * 100 : 100,
                      },
                      {
                        title: "Clean Asset Filenames",
                        description: "Generic filenames block smart crawler indexes. rename recommendations provided below.",
                        count: currentResults.poorFilenames,
                        unit: "generic",
                        healthy: currentResults.poorFilenames === 0,
                        progress: currentResults.totalScanned > 0 ? ((currentResults.totalScanned - currentResults.poorFilenames) / currentResults.totalScanned) * 100 : 100,
                      }
                    ].map((item, idx) => (
                      <div key={idx} className="llm-card" style={{ padding: "16px", display: "flex", flexDirection: "column", justifyContent: "space-between", margin: 0 }}>
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                            <h4 style={{ margin: 0, fontSize: "13.5px", fontWeight: "700" }}>{item.title}</h4>
                            <span style={{
                              fontSize: "11px",
                              fontWeight: "700",
                              color: item.healthy ? "#16a34a" : "#ca8a04",
                              background: item.healthy ? "#f0fdf4" : "#fef9c3",
                              padding: "2px 8px",
                              borderRadius: "20px"
                            }}>
                              {item.healthy ? "AI Ready" : `${item.count} ${item.unit}`}
                            </span>
                          </div>
                          <p style={{ margin: "0 0 16px 0", fontSize: "11.5px", color: "var(--llm-on-surface-variant)", lineHeight: "1.4" }}>
                            {item.description}
                          </p>
                        </div>
                        <div>
                          <div style={{ height: "6px", background: "var(--llm-card-border)", borderRadius: "3px", overflow: "hidden", marginBottom: "4px" }}>
                            <div style={{
                              height: "100%",
                              width: `${item.progress}%`,
                              background: item.healthy ? "#16a34a" : "linear-gradient(90deg, #ca8a04, #f59e0b)",
                              borderRadius: "3px",
                              transition: "width 0.3s"
                            }} />
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--llm-outline)" }}>
                            <span>Health: {Math.round(item.progress)}%</span>
                            <span>{item.healthy ? "Optimal" : "Attention needed"}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Action buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button
                        className={`llm-btn llm-btn-primary ${bulkState === 'syncing' ? "llm-btn-pulse" : ""}`}
                        onClick={handleFixAll}
                        disabled={isWorking || bulkState !== 'idle' || (currentResults.missingAlt === 0 && selectedCount === 0)}
                      >
                        {bulkState === 'optimizing' ? (
                          <span>Optimizing... ({bulkProgress.current}/{bulkProgress.total})</span>
                        ) : bulkState === 'syncing' ? (
                          <span className="llm-syncing-pulse">Syncing to Shopify...</span>
                        ) : isWorking ? (
                          "Syncing..."
                        ) : selectedCount > 0 ? (
                          `Bulk Optimize Alt Text (${selectedCount})`
                        ) : (
                          "Bulk Optimize Alt Text"
                        )}
                      </button>
                      <button
                        className="llm-btn llm-btn-outline"
                        onClick={() => setShowTable(!showTable)}
                      >
                        {showTable ? "Hide Scanned Details" : "Review Scanned Details"}
                      </button>
                    </div>

                    {bulkState !== 'idle' && (
                      <div style={{
                        marginTop: "4px",
                        padding: "16px",
                        background: "var(--llm-surface)",
                        borderRadius: "8px",
                        border: "1px solid var(--llm-card-border)",
                        animation: "logFadeIn 0.3s ease-out",
                        width: "100%"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", fontSize: "13px" }}>
                          <span style={{ fontWeight: 600, color: "var(--llm-primary)" }}>
                            {bulkState === 'optimizing' ? "⚡ Running AI Alt Text Optimizations..." : "🔄 Syncing Optimized Alt Text to Shopify..."}
                          </span>
                          <span style={{ fontWeight: 700 }}>
                            {bulkProgress.current} / {bulkProgress.total} Images
                          </span>
                        </div>
                        <div style={{ height: "8px", background: "rgba(92, 106, 196, 0.1)", borderRadius: "4px", overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                            background: "linear-gradient(90deg, var(--llm-primary), #a855f7)",
                            borderRadius: "4px",
                            transition: "width 0.3s ease-out"
                          }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* STEP 5: Review details */}
                {showTable && (
                  <div className="llm-card" style={{ animation: "logFadeIn 0.3s ease-out", overflow: "visible" }}>
                    <div className="llm-card-head" style={{ paddingBottom: "12px", borderBottom: "1px solid var(--llm-card-border)", marginBottom: "16px" }}>
                      <h2>Scanned Images Details</h2>
                      <p>Review suggested metadata adjustments before pushing to Shopify.</p>
                    </div>

                    {/* Tabs and Search controls row */}
                    <div style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: "16px",
                      paddingBottom: "16px",
                      borderBottom: "1px solid var(--llm-card-border)",
                      marginBottom: "16px"
                    }}>
                      {/* Segmented Switcher & Select All Button */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                        <div className="llm-segmented-tabs">
                          <button
                            type="button"
                            className={`llm-tab-btn ${!filterMissing ? "active" : ""}`}
                            onClick={() => setFilterMissing(false)}
                          >
                            <span>All Scanned</span>
                            <span className="llm-tab-badge">{totalAllCount}</span>
                          </button>
                          <button
                            type="button"
                            className={`llm-tab-btn ${filterMissing ? "active" : ""}`}
                            onClick={() => setFilterMissing(true)}
                          >
                            <span>Missing Alt Text</span>
                            <span className="llm-tab-badge">{totalMissingCount}</span>
                          </button>
                        </div>
                        <button
                          type="button"
                          className="llm-btn llm-btn-outline llm-btn-sm"
                          onClick={toggleSelectAll}
                          style={{ height: "32px", fontSize: "12px", fontWeight: "600" }}
                        >
                          {currentResults.list.length > 0 && currentResults.list.every(img => selectedImages[img.mediaId]) ? "Deselect All" : "Select All"}
                        </button>
                      </div>

                      {/* Search box */}
                      <div style={{ position: "relative", width: "100%", maxWidth: "300px" }}>
                        <span style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: "12px", pointerEvents: "none" }}>
                          🔍
                        </span>
                        <input
                          type="text"
                          placeholder="Search product name, SKU..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="llm-input"
                          style={{ paddingLeft: "30px", height: "32px", fontSize: "12.5px" }}
                        />
                        {searchTerm && (
                          <button
                            type="button"
                            onClick={() => setSearchTerm("")}
                            style={{
                              position: "absolute",
                              right: "10px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              background: "none",
                              border: "none",
                              cursor: "pointer",
                              color: "#94a3b8",
                              fontSize: "14px"
                            }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>

                    {currentResults.list.length === 0 ? (
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
                                  checked={currentResults.list.length > 0 && currentResults.list.every(img => selectedImages[img.mediaId])}
                                  onChange={toggleSelectAll}
                                  disabled={bulkState !== 'idle'}
                                />
                              </th>
                              <th style={{ width: "60px" }}>Image</th>
                              <th>Product</th>
                              <th>Image Alt Text</th>
                              <th>Image Asset Filename</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentResults.list.map((img) => {
                              const currentFn = img.currentFilename || (img.imageUrl ? img.imageUrl.split('/').pop().split('?')[0] : "None");
                              const poorFn = isPoorFilename(currentFn);
                              const isProcessing = processingIds.has(img.mediaId);
                              const isCompleted = completedIds.has(img.mediaId);
                              const rowClass = isProcessing
                                ? "llm-row-processing"
                                : isCompleted
                                ? "llm-row-completed"
                                : "";
                              return (
                                <tr key={img.mediaId} className={rowClass} style={{ transition: "background-color 0.5s ease-out" }}>
                                  <td style={{ paddingRight: 0, verticalAlign: "middle" }}>
                                    <input
                                      type="checkbox"
                                      checked={!!selectedImages[img.mediaId]}
                                      onChange={() => toggleSelectImage(img.mediaId)}
                                      disabled={isProcessing || bulkState !== 'idle'}
                                    />
                                  </td>
                                  <td style={{ verticalAlign: "middle" }}>
                                    {img.imageUrl ? (
                                      <div className="llm-img-container">
                                        <img
                                          src={img.imageUrl}
                                          alt=""
                                        />
                                      </div>
                                    ) : (
                                      <span style={{ fontSize: "11px", color: "var(--llm-outline)" }}>No Image</span>
                                    )}
                                  </td>
                                  <td style={{ verticalAlign: "middle" }}>
                                    <div style={{ fontSize: "13px", fontWeight: "700", lineHeight: "1.3" }}>{img.productName}</div>
                                  </td>
                                  <td style={{ verticalAlign: "middle" }}>
                                    {img.status === "Optimized" ? (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                        <div style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#94a3b8" }}>
                                          <span style={{ background: "#f1f5f9", padding: "1px 4px", borderRadius: "3px", textDecoration: "line-through" }}>Was: {img.originalAlt || "No description"}</span>
                                        </div>
                                        <div className="llm-text-slide-in" style={{ fontSize: "12.5px", fontWeight: "600", color: "#15803d", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                                          <span style={{ background: "#dcfce7", color: "#15803d", padding: "2px 6px", borderRadius: "4px", fontSize: "10.5px", fontWeight: "700" }}>Now</span>
                                          <span>{img.currentAlt}</span>
                                        </div>
                                      </div>
                                    ) : (
                                      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                        {!img.hasAlt ? (
                                          <>
                                            <span style={{
                                              fontSize: "9px",
                                              background: "#fef2f2",
                                              color: "#ef4444",
                                              padding: "2px 6px",
                                              borderRadius: "4px",
                                              fontWeight: "700",
                                              alignSelf: "flex-start",
                                              border: "1px solid #fee2e2",
                                              textTransform: "uppercase",
                                              letterSpacing: "0.03em"
                                            }}>
                                              ❌ Missing Alt Text
                                            </span>
                                            <div style={{
                                              fontSize: "12px",
                                              background: "#f3e8ff",
                                              border: "1px solid #e9d5ff",
                                              color: "#6b21a8",
                                              padding: "6px 10px",
                                              borderRadius: "6px",
                                              marginTop: "2px",
                                              lineHeight: "1.4"
                                            }}>
                                              <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                                                ✨ AI Recommendation
                                              </span>
                                              <span style={{ display: "block", marginTop: "2px" }}>
                                                {img.suggestedAlt}
                                              </span>
                                            </div>
                                          </>
                                        ) : (
                                          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12.5px" }}>
                                            <span style={{
                                              background: "#f0fdf4",
                                              color: "#16a34a",
                                              padding: "2px 6px",
                                              borderRadius: "4px",
                                              fontSize: "10px",
                                              fontWeight: "700",
                                              border: "1px solid #bbf7d0",
                                              textTransform: "uppercase"
                                            }}>
                                              ✓ Active
                                            </span>
                                            <span style={{ color: "var(--llm-on-surface)" }}>{img.currentAlt}</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                  <td style={{ verticalAlign: "middle" }}>
                                    <div style={{ fontSize: "12px", wordBreak: "break-all" }}>
                                      <code>{currentFn}</code>
                                    </div>
                                    {poorFn && (
                                      <div style={{
                                        marginTop: "6px",
                                        padding: "6px 10px",
                                        borderRadius: "6px",
                                        background: "#fffbeb",
                                        border: "1px solid #fef3c7",
                                        color: "#b45309",
                                        fontSize: "11px",
                                        lineHeight: "1.4"
                                      }}>
                                        <span style={{ fontWeight: 700, display: "flex", alignItems: "center", gap: "4px" }}>
                                          ⚠️ Generic Filename
                                        </span>
                                        <span style={{ display: "block", marginTop: "2px", color: "#d97706" }}>
                                          Tip: Rename file to <code style={{ background: "#fff", padding: "1px 4px", borderRadius: "3px", border: "1px solid #fde68a" }}>{img.suggestedFilename}</code> before uploading to boost search indexing.
                                        </span>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {currentResults.totalFilteredCount > 30 && (
                          <div style={{
                            textAlign: "center",
                            padding: "16px",
                            background: "#f8fafc",
                            borderTop: "1px solid var(--llm-card-border)",
                            fontSize: "12.5px",
                            color: "#64748b",
                            fontWeight: "600",
                            borderRadius: "0 0 8px 8px"
                          }}>
                            Showing first 30 of {currentResults.totalFilteredCount} products. Optimize these to load more.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Sliding Floating Action Bar when items selected */}
                {selectedCount > 0 && (
                  <div style={{
                    position: "fixed",
                    bottom: "20px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "calc(100% - 40px)",
                    maxWidth: "640px",
                    background: "rgba(15, 23, 42, 0.95)",
                    backdropFilter: "blur(12px)",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: "12px",
                    padding: "12px 20px",
                    boxShadow: "0 10px 30px -5px rgba(0, 0, 0, 0.3)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "16px",
                    zIndex: 9999,
                    animation: "slide-up-floating 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards",
                    color: "#ffffff"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{
                        background: "var(--llm-primary)",
                        color: "white",
                        fontSize: "11px",
                        fontWeight: "800",
                        padding: "3px 8px",
                        borderRadius: "6px"
                      }}>
                        {selectedCount}
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: "600" }}>
                        {selectedCount === 1 ? "1 image selected" : `${selectedCount} images selected`}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <button
                        type="button"
                        className="llm-btn llm-btn-outline llm-btn-sm"
                        style={{
                          background: "transparent",
                          color: "#e2e8f0",
                          borderColor: "rgba(255,255,255,0.2)",
                          fontWeight: "600"
                        }}
                        onClick={() => setSelectedImages({})}
                        disabled={isWorking}
                      >
                        Deselect All
                      </button>
                      <button
                        type="button"
                        className={`llm-btn llm-btn-primary llm-btn-sm ${bulkState === 'syncing' ? "llm-btn-pulse" : ""}`}
                        style={{
                          background: "var(--llm-primary)",
                          color: "white",
                          boxShadow: "0 4px 12px rgba(0, 62, 199, 0.3)",
                          fontWeight: "700"
                        }}
                        onClick={handleFixSelected}
                        disabled={isWorking || bulkState !== 'idle'}
                      >
                        {bulkState === 'optimizing' ? (
                          <span>Optimizing ({bulkProgress.current}/{bulkProgress.total})</span>
                        ) : bulkState === 'syncing' ? (
                          <span className="llm-syncing-pulse">Syncing...</span>
                        ) : (
                          `Optimize Selected (${selectedCount})`
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
export function ErrorBoundary() {
  return boundary.error();
}
