import phase11Change4Worker from './index-phase11-change4.js';
import { withOwnerHomeworkCatalogue } from './phase11-owner-homeworks.js';

export default {
  async fetch(request, env, ctx) {
    return phase11Change4Worker.fetch(request, withOwnerHomeworkCatalogue(env), ctx);
  }
};
