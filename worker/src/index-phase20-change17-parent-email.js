import change16Worker from './index-phase20-change16.js';
import { handleAdminLessonReleaseImport } from './admin-lesson-release-import-email.js';
import { FPT_EMAIL_SIGNATURE_PNG_BASE64 } from './parent-email-signature.js';

const EMAIL_SIGNATURE_PATH = '/api/v1/public/email-signature-v1.png';
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

// Change 17 adds parent transactional email delivery to the existing admin CSV
// import without changing the underlying Change 16 student-portal behaviour.
// Admin lesson-release requests are intercepted here so Portal entitlement writes
// remain handled by the established importer; the email wrapper normalises normal
// Y4/Y5/Y6 display prefixes and sends parent mail only after a successful confirm.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === EMAIL_SIGNATURE_PATH && (request.method === 'GET' || request.method === 'HEAD')) {
      return emailSignatureResponse(request);
    }

    const adminResponse = await handleAdminLessonReleaseImport(request, env);
    if (adminResponse) return adminResponse;
    return change16Worker.fetch(request, env, ctx);
  }
};

export { EMAIL_SIGNATURE_PATH, emailSignatureResponse };
