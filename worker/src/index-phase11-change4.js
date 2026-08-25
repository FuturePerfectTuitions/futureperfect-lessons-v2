import phase11EfficientWorker from './index-phase11-efficient.js';
import { prepareYear5AnswerPdfEnv } from './phase11-year5-answer-pdf.js';

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = await prepareYear5AnswerPdfEnv(request, env);
    return phase11EfficientWorker.fetch(request, runtimeEnv, ctx);
  }
};
