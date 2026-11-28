// Vercel function entry point. The API is compiled by `pnpm build` (tsc → dist/); every path is
// rewritten here by vercel.json, and Nest's own router takes over.
export { default } from "../dist/serverless.js";
