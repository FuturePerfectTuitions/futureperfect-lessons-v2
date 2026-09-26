const clean = value => String(value ?? '').trim();

function lessonKey(row) {
  if (!row || typeof row !== 'object') return '';
  return Object.keys(row).find(key => clean(key).toLowerCase() === 'lesson') || '';
}

function normaliseY6SatsPortalAlias(row) {
  if (!row || typeof row !== 'object') return row;
  const key = lessonKey(row);
  if (!key) return { ...row };

  const value = String(row[key] ?? '');
  const converted = value.replace(/^\s*Y6SM([1-9]|1[0-9])(?=\s|$)/i, match => {
    const number = match.match(/([1-9]|1[0-9])$/)?.[1] || '';
    return `Y6MS${number}`;
  });

  return converted === value ? { ...row } : { ...row, [key]:converted };
}

export { normaliseY6SatsPortalAlias };
