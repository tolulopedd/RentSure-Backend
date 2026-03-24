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

export function createApp() {
  const app = express();

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use(requestContextMiddleware);
  app.use(cors());
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
  app.use("/api", mailPreviewRoutes);

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
