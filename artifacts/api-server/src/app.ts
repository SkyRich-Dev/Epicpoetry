import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { verifyToken } from "./lib/auth";
import { enforceSaasAccess, runWithTenantSchema } from "./lib/saas";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PUBLIC_PATHS = [
  "/api/healthz",
  "/api/auth/login",
  "/api/auth/forgot-password",
  "/api/auth/password-tokens/complete",
];
const PUBLIC_PREFIXES = ["/api/webhook/", "/api/internal/saas/"];
app.use("/api", async (req: Request, res: Response, next: NextFunction) => {
  const path = req.path.startsWith("/") ? `/api${req.path}` : `/api/${req.path}`;
  if (
    PUBLIC_PATHS.some(p => path === p)
    || path.startsWith("/api/auth/password-tokens/")
    || PUBLIC_PREFIXES.some(p => path.startsWith(p))
  ) {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  (req as any).userId = payload.userId;
  (req as any).userRole = payload.role;
  (req as any).tenantSchemaName = payload.tenantSchemaName;
  runWithTenantSchema(payload.tenantSchemaName, () => {
    enforceSaasAccess(req, res, next).catch(next);
  });
});

app.use("/api", router);

app.use("/api", (err: any, req: Request, res: Response, next: NextFunction) => {
  req.log?.error({
    err,
    event: "api.unhandled_error",
    path: req.originalUrl,
    method: req.method,
    tenantSchemaName: (req as any).tenantSchemaName ?? null,
    userId: (req as any).userId ?? null,
  }, "Unhandled API error");

  if (res.headersSent) {
    next(err);
    return;
  }

  const status = Number(err?.statusCode || err?.status || 500);
  res.status(status).json({
    success: false,
    message: err?.message || "Internal Server Error",
    errorCode: err?.errorCode || "INTERNAL_SERVER_ERROR",
  });
});

export default app;
