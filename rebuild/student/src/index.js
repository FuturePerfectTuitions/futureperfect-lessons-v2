import { createStudentRuntime } from './lib/runtime.mjs';
const runtime = createStudentRuntime();
export { createStudentRuntime };
export default { fetch(request, env) { return runtime.fetch(request, env); } };
