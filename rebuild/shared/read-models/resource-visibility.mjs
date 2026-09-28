import { viewDefinition } from './view-registry.mjs';

const clean = value => String(value ?? '').trim();

function resourcePresentationScopes(resource) {
  const raw = Array.isArray(resource?.presentationScopes) ? resource.presentationScopes : [];
  const scopes = [...new Set(raw.map(value => clean(value)).filter(Boolean))];
  return scopes.length ? scopes : ['core'];
}

function resourceVisibleForView(resource, viewId, state = {}) {
  const scopes = resourcePresentationScopes(resource);
  if (scopes.includes('core')) return true;
  const definition = viewDefinition(viewId);
  if (scopes.includes('elevenPlus') && definition?.stream === '11plus') return true;
  if (scopes.includes('vr') && state?.vrAvailable === true) return true;
  return false;
}

export { resourcePresentationScopes, resourceVisibleForView };
