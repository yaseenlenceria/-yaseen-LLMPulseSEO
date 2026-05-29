export const GET_PRODUCT_IMAGES_QUERY = `#graphql
  query GetProductImages($first: Int!) {
    shop {
      name
    }
    products(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        productType
        vendor
        variants(first: 1) {
          nodes {
            sku
            barcode
          }
        }
        media(first: 10) {
          nodes {
            id
            mediaContentType
            ... on MediaImage {
              id
              alt
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export const UPDATE_MEDIA_ALT_MUTATION = `#graphql
  mutation ProductUpdateMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
    productUpdateMedia(productId: $productId, media: $media) {
      media {
        id
        alt
      }
      mediaUserErrors {
        field
        message
      }
    }
  }
`;
export const UPDATE_FILE_MUTATION = `#graphql
  mutation fileUpdate($files: [FileUpdateInput!]!) {
    fileUpdate(files: $files) {
      files {
        id
        alt
        ... on MediaImage {
          id
          image {
            url
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export function generateFromTemplate(template, data) {
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

  // Strip remaining variables
  result = result.replace(/#[^#]+#/g, "");
  // Clean double spaces
  result = result.replace(/\s+/g, " ").trim();
  return result;
}

export function generateFilenameSuggestion(template, data, originalUrl) {
  const rawSuggestion = generateFromTemplate(template, data);
  // Clean filename: alphanumeric, underscores, hyphens
  let cleanName = rawSuggestion
    .replace(/[^a-zA-Z0-9_\-\s]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  // Extract extension from original URL, default to jpg
  let ext = "jpg";
  if (originalUrl) {
    const pathPart = originalUrl.split("?")[0];
    const match = pathPart.match(/\.([a-zA-Z0-9]+)$/);
    if (match) {
      ext = match[1].toLowerCase();
    }
  }

  return `${cleanName}.${ext}`;
}

export async function fetchProductImages(admin, limit = 50, settings = {}) {
  const response = await admin.graphql(GET_PRODUCT_IMAGES_QUERY, {
    variables: { first: limit },
  });
  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  const shopName = payload.data.shop.name;
  const products = payload.data.products.nodes;
  const images = [];

  const altTemplate = settings.altTemplate || "#product_name# - #product_type#";
  const filenameTemplate = settings.filenameTemplate || "#product_name# - #product_vendor#";

  for (const product of products) {
    const sku = product.variants.nodes[0]?.sku || "";
    const barcode = product.variants.nodes[0]?.barcode || "";

    const templateData = {
      productName: product.title,
      productType: product.productType,
      productVendor: product.vendor,
      shopName,
      sku,
      barcode,
    };

    if (product.media && product.media.nodes) {
      for (const mediaNode of product.media.nodes) {
        if (mediaNode.mediaContentType === "IMAGE") {
          const currentAlt = mediaNode.alt || "";
          const originalUrl = mediaNode.image?.url || "";

          const suggestedAlt = generateFromTemplate(altTemplate, templateData);
          const suggestedFilename = generateFilenameSuggestion(filenameTemplate, templateData, originalUrl);

          images.push({
            productId: product.id,
            productName: product.title,
            productType: product.productType || "",
            productVendor: product.vendor || "",
            sku,
            barcode,
            mediaId: mediaNode.id,
            imageUrl: originalUrl,
            currentAlt,
            suggestedAlt,
            suggestedFilename,
            hasAlt: currentAlt.trim().length > 0,
            status: currentAlt.trim().length > 0 ? "Optimized" : "Missing ALT Text",
          });
        }
      }
    }
  }

  return {
    shopName,
    images,
  };
}

export async function updateImageAlt(admin, productId, mediaId, altText) {
  const response = await admin.graphql(UPDATE_MEDIA_ALT_MUTATION, {
    variables: {
      productId,
      media: [
        {
          id: mediaId,
          alt: altText,
        },
      ],
    },
  });

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  const userErrors = payload.data?.productUpdateMedia?.mediaUserErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map((e) => e.message).join("; "));
  }

  return { ok: true, mediaId, altText };
}

export async function updateImageMetadata(admin, mediaId, altText, filename) {
  const fileInput = { id: mediaId };
  if (altText !== undefined) {
    fileInput.alt = altText;
  }
  if (filename) {
    fileInput.filename = filename;
  }

  const response = await admin.graphql(UPDATE_FILE_MUTATION, {
    variables: {
      files: [fileInput]
    }
  });

  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }

  const userErrors = payload.data?.fileUpdate?.userErrors;
  if (userErrors?.length) {
    throw new Error(userErrors.map((e) => e.message).join("; "));
  }

  return { ok: true, mediaId, altText, filename };
}

