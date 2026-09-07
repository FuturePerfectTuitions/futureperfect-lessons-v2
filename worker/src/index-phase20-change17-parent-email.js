import change16Worker from './index-phase20-change16.js';
import { handleAdminLessonReleaseImport } from './admin-lesson-release-import-email.js';

// Change 17 adds parent transactional email delivery to the existing admin CSV
// import without changing the underlying Change 16 student-portal behaviour.
// Admin lesson-release requests are intercepted here so Portal entitlement writes
// remain handled by the established importer; the email wrapper normalises normal
// Y4/Y5/Y6 display prefixes and sends parent mail only after a successful confirm.
export default {
  async fetch(request, env, ctx) {
    const adminResponse = await handleAdminLessonReleaseImport(request, env);
    if (adminResponse) return adminResponse;
    return change16Worker.fetch(request, env, ctx);
  }
};
