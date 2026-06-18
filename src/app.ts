import path from "node:path";
import { fileURLToPath } from "node:url";
import pgSession from "connect-pg-simple";
import express from "express";
import session from "express-session";
import methodOverride from "method-override";
import { env } from "./config/env.js";
import { pool } from "./db/index.js";
import { attachUser } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { flash } from "./middleware/flash.js";
import { accountsRoutes } from "./routes/accounts.routes.js";
import { authRoutes } from "./routes/auth.routes.js";
import { categoriesRoutes } from "./routes/categories.routes.js";
import { dashboardRoutes } from "./routes/dashboard.routes.js";
import { payeesRoutes } from "./routes/payees.routes.js";
import { scenariosRoutes } from "./routes/scenarios.routes.js";
import { settingsRoutes } from "./routes/settings.routes.js";
import { transactionsRoutes } from "./routes/transactions.routes.js";
import { futureCommitmentsRoutes } from "./routes/futureCommitments.routes.js";
import { getOverdueCommitments } from "./services/futureCommitments.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PgSession = pgSession(session);

export const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true, limit: "5mb", parameterLimit: 50_000 }));
app.use(express.json({ limit: "5mb" }));
app.use(methodOverride("_method"));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    store: new PgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true
    }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 12
    }
  })
);

app.use(flash);
app.use(attachUser);
app.use((req, res, next) => {
  res.locals.currentUser = req.user;
  res.locals.flash = {
    success: req.flash("success"),
    error: req.flash("error")
  };
  next();
});
app.use(async (req, res, next) => {
  try {
    res.locals.overdueCommitmentCount = req.user ? (await getOverdueCommitments()).length : 0;
    next();
  } catch (error) {
    next(error);
  }
});

app.use(authRoutes);
app.use("/", dashboardRoutes);
app.use("/accounts", accountsRoutes);
app.use("/categories", categoriesRoutes);
app.use("/payees", payeesRoutes);
app.use("/transactions", transactionsRoutes);
app.use("/commitments", futureCommitmentsRoutes);
app.use("/scenarios", scenariosRoutes);
app.use("/settings", settingsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
