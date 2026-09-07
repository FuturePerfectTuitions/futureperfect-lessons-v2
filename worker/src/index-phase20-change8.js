import phase20Worker from './index-phase20-change7.js';
import { handleAdminLessonReleaseImport } from './admin-lesson-release-import.js';

export default {
  async fetch(request, env, ctx) {
    const adminResponse = await handleAdminLessonReleaseImport(request, env);
    if (adminResponse) return adminResponse;
    return phase20Worker.fetch(request, env, ctx);
  }
};
