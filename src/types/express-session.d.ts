import "express-session";
import type { ImportPreview } from "../services/transactionImport.service.js";

declare module "express-session" {
  interface SessionData {
    userId?: string;
    transactionImportPreview?: ImportPreview;
  }
}
