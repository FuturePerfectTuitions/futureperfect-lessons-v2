import phase11EfficientWorker from './index-phase11-efficient.js';
import { prepareSharedMathsAnswerPdfEnv } from './phase11-shared-maths-answer-pdf.js';

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = await prepareSharedMathsAnswerPdfEnv(request, env);
    return phase11EfficientWorker.fetch(request, runtimeEnv, ctx);
  }
};
