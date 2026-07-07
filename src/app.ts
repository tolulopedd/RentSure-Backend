import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";

import { requestContextMiddleware } from "./middleware/request-context.middleware";
import { errorMiddleware } from "./middleware/error.middleware";

import { healthRoutes } from "./modules/health/health.routes";
import { authRoutes } from "./modules/auth/auth.routes";
import { rentScoreRoutes } from "./modules/rent-score/rent-score.routes";
import { workspaceRoutes } from "./modules/workspace/workspace.routes";
import { renterRoutes } from "./modules/renter/renter.routes";
import { storageRoutes } from "./modules/storage/storage.routes";
import { mailPreviewRoutes } from "./modules/mail-preview/mail-preview.routes";
import { env } from "./config/env";

function allowedCorsOrigins() {
  const values = new Set<string>();

  if (env.APP_WEB_BASE_URL?.trim()) {
    values.add(env.APP_WEB_BASE_URL.replace(/\/+$/, ""));
  }

  if (process.env.NODE_ENV !== "production") {
    values.add("http://localhost:5173");
    values.add("http://127.0.0.1:5173");
  }

  return values;
}

export function createApp() {
  const app = express();
  const allowedOrigins = allowedCorsOrigins();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use(requestContextMiddleware);
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin not allowed by CORS"));
      }
    })
  );
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));
  app.use(morgan("dev"));
  app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

  app.use("/api", healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", rentScoreRoutes);
  app.use("/api", workspaceRoutes);
  app.use("/api", renterRoutes);
  app.use("/api", storageRoutes);
  if (process.env.NODE_ENV !== "production") {
    app.use("/api", mailPreviewRoutes);
  }

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Route not found"
      }
    });
  });

  app.use(errorMiddleware);

  return app;
}
