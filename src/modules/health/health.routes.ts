import { Router } from "express";

const router = Router();

router.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "rentsure-api",
    requestId: req.requestId ?? null,
    ts: new Date().toISOString()
  });
});

export const healthRoutes = router;
