/**
 * Re-export pdf-parse's types from the inner module path so we can use
 *   import pdfParse from "pdf-parse/lib/pdf-parse.js";
 * which skips the debug shim in pdf-parse/index.js that crashes on Vercel
 * (it tries to fs.readFileSync a sample PDF on module init).
 *
 * @types/pdf-parse only declares the top-level module entry, so without this
 * shim TS fails the build with TS7016 ("could not find a declaration file").
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  import pdfParse from "pdf-parse";
  export default pdfParse;
}
