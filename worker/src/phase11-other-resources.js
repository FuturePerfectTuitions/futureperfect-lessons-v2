function text(value) {
  return String(value || '').trim();
}

function normaliseFile(value, fallbackName = '11+ Additional Resource') {
  if (!value || typeof value !== 'object') return null;
  const r2Key = text(value.r2Key || value.r2);
  if (!r2Key) return null;
  return {
    displayName: text(value.displayName || value.name) || fallbackName,
    r2Key
  };
}

function normaliseElevenPlusOther(record) {
  const values = record?.phase11OtherResources?.elevenPlus;
  if (!Array.isArray(values)) return [];
  return values
    .map(value => normaliseFile(value))
    .filter(Boolean);
}

function elevenPlusOtherAt(record, index) {
  if (!Number.isInteger(index) || index < 1) return null;
  return normaliseElevenPlusOther(record)[index - 1] || null;
}

export {
  normaliseElevenPlusOther,
  elevenPlusOtherAt
};
