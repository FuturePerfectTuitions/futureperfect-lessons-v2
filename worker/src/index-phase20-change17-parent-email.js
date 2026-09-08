import fastNavigationWorker from './index-phase20-change17.js';
import { handleAdminLessonReleaseImport } from './admin-lesson-release-import-email.js';
import { FPT_EMAIL_SIGNATURE_PNG_BASE64 } from './parent-email-signature.js';
import { repairLiveStudentCatalogueResponse } from './live-student-catalogue-overlay.js';

const EMAIL_SIGNATURE_PATH = '/api/v1/public/email-signature-v1.png';
const PERMANENT_PARENT_EMAIL_BCC = 'sej@futureperfect.education';
let emailSignatureBytes = null;

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function emailSignatureResponse(request) {
  if (!emailSignatureBytes) emailSignatureBytes = decodeBase64(FPT_EMAIL_SIGNATURE_PNG_BASE64);
  return new Response(request.method === 'HEAD' ? null : emailSignatureBytes, {
    status: 200,
    headers: {
      'content-type':'image/png',
      'cache-control':'public, max-age=86400',
      'x-content-type-options':'nosniff'
    }
  });
}

function envWithPermanentParentEmailBcc(env) {
  const testRecipient = String(env?.PARENT_EMAIL_TEST_TO ?? '').trim();
  if (testRecipient || !env?.EMAIL || typeof env.EMAIL.send !== 'function') return env;

  const originalEmailBinding = env.EMAIL;
  const wrappedEmailBinding = {
    async send(payload) {
      const outgoing = {
        ...(payload || {}),
        bcc: payload?.bcc || { email:PERMANENT_PARENT_EMAIL_BCC, name:'Sejal Dalal' }
      };
      return originalEmailBinding.send(outgoing);
    }
  };

  return new Proxy(env, {
    get(target, prop, receiver) {
      if (prop === 'EMAIL') return wrappedEmailBinding;
      return Reflect.get(target, prop, receiver);
    }
  });
}

// Parent transactional email remains the outermost production layer. Student
// requests now pass through the lightweight Change 17 navigation wrapper before
// the existing Change 16 access-control chain. The fast navigation endpoint does
// not weaken lesson/resource gates; all non-navigation requests delegate through
// the established Worker exactly as before.
// Student catalogue-list responses are repaired last so stale bundled catalogue
// overlays cannot re-introduce retired lessons or shift live Drive/KV display IDs.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === EMAIL_SIGNATURE_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return emailSignatureResponse(request);
    }

    const adminResponse = await handleAdminLessonReleaseImport(request, envWithPermanentParentEmailBcc(env));
    if (adminResponse) return adminResponse;

    const response = await fastNavigationWorker.fetch(request, env, ctx);
    return repairLiveStudentCatalogueResponse(
      request,
      env,
      ctx,
      response,
      (innerRequest, innerEnv, innerCtx) => fastNavigationWorker.fetch(innerRequest, innerEnv, innerCtx)
    );
  }
};

export {
  EMAIL_SIGNATURE_PATH,
  PERMANENT_PARENT_EMAIL_BCC,
  emailSignatureResponse,
  envWithPermanentParentEmailBcc
};
