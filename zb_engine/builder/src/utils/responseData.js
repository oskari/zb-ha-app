/**
 * responseData.js — shared normalization of a source-test response into the
 * shape stored in the canvas source cache (uiStore.sourceResponsesById).
 *
 * Used by BOTH the manual "Test Source" button (panels/SourcesPanel.jsx) and
 * the canvas auto-fetch hook (editor/useAutoFetchSources.js) so that live
 * canvas previews see exactly the same data a manual test produces — including
 * primitive (string/number/boolean) values, not just object responses.
 */

function xmlDocumentToObject(node) {
  if (!node) return null;

  // Text node
  if (node.nodeType === 3) {
    const text = node.nodeValue;
    const trimmed = typeof text === 'string' ? text.trim() : '';
    return trimmed ? trimmed : null;
  }

  // Element node
  if (node.nodeType !== 1) return null;

  const obj = {};

  // Attributes: use flat "@_attrName" keys to match the server's
  // fast-xml-parser config (attributeNamePrefix: "@_").  This ensures
  // binding paths generated from the test preview resolve identically
  // at render time.
  if (node.attributes && node.attributes.length > 0) {
    for (const attr of node.attributes) {
      obj[`@_${attr.name}`] = attr.value;
    }
  }

  const children = Array.from(node.childNodes || []);
  const elementChildren = children.filter((c) => c.nodeType === 1);
  const textChildren = children.filter((c) => c.nodeType === 3);
  const textValue = textChildren
    .map((c) => (typeof c.nodeValue === 'string' ? c.nodeValue.trim() : ''))
    .filter(Boolean)
    .join(' ');

  if (elementChildren.length === 0) {
    if (Object.keys(obj).length === 0) return textValue || '';
    if (textValue) obj['#text'] = textValue;
    return obj;
  }

  for (const child of elementChildren) {
    const key = child.nodeName;
    const value = xmlDocumentToObject(child);
    if (obj[key] === undefined) {
      obj[key] = value;
    } else if (Array.isArray(obj[key])) {
      obj[key].push(value);
    } else {
      obj[key] = [obj[key], value];
    }
  }

  if (textValue) obj['#text'] = textValue;
  return obj;
}

/**
 * Normalize a raw source-test `data` value for caching/binding resolution.
 * Returns `null` when there is no usable data (so callers can skip caching).
 *
 * @param {string} responseType  'json' | 'xml' | 'csv' | 'text'
 * @param {*}      data          The `data` field from the source-test result.
 */
export function normalizeResponseData(responseType, data) {
  if (data === null || data === undefined) return null;
  if (responseType === 'json') {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }
    return data;
  }

  if (responseType === 'xml' && typeof data === 'string') {
    try {
      const doc = new DOMParser().parseFromString(data, 'application/xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) return null;
      const root = doc.documentElement;
      return { [root.nodeName]: xmlDocumentToObject(root) };
    } catch {
      return null;
    }
  }

  // text / csv / other – best-effort: try JSON parse so the DataTree can
  // display structured data.  For plain text, store the raw string as-is;
  // DataTree shows "No object data" which is accurate and avoids creating
  // binding paths (like _raw) that don't exist at render time.
  if (typeof data === 'object') return data;
  if (typeof data === 'string') {
    try { return JSON.parse(data); } catch { /* not JSON */ }
    return data;
  }
  return null;
}
