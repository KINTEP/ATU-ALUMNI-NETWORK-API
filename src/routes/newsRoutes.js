// src/routes/newsRoutes.js
import express from "express";
import newsController from "../controllers/newsController.js";
import { verifyToken, isAdmin, optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ── IMPORTANT: Static and specific routes MUST come before /:id ──
// Express matches top-to-bottom. Any fixed path segment registered after /:id
// will never be reached because /:id swallows it first.

// ── Collection & filter routes (no :id) ──
router.get("/", optionalAuth, newsController.getAllArticles);
router.get("/featured", optionalAuth, newsController.getFeaturedArticles);
router.get("/latest", optionalAuth, newsController.getLatestArticles);
router.get("/popular", optionalAuth, newsController.getPopularArticles);
router.get("/stats", newsController.getNewsStats);

// ✅ FIX: /slug/:slug MUST be before /:id — otherwise GET /slug/my-article
// is matched as /:id where id='slug', and the actual slug is lost
router.get("/slug/:slug", optionalAuth, newsController.getArticleBySlug);

// Admin-only creation (no :id) — must be before /:id routes
router.post("/", verifyToken, isAdmin, newsController.createArticle);

// ── Dynamic :id routes ──
router.get("/:id", optionalAuth, newsController.getArticleById);
router.get("/:id/comments", optionalAuth, newsController.getArticleComments);
router.post("/:id/view", optionalAuth, newsController.incrementViewCount);

router.post("/:id/like", verifyToken, newsController.likeArticle);
router.delete("/:id/unlike", verifyToken, newsController.unlikeArticle);

router.post("/:id/comments", verifyToken, newsController.addComment);
router.put("/:id/comments/:commentId", verifyToken, newsController.updateComment);
router.delete("/:id/comments/:commentId", verifyToken, newsController.deleteComment);
router.post("/:id/comments/:commentId/like", verifyToken, newsController.likeComment);
router.delete("/:id/comments/:commentId/unlike", verifyToken, newsController.unlikeComment);

router.put("/:id", verifyToken, isAdmin, newsController.updateArticle);
router.delete("/:id", verifyToken, isAdmin, newsController.deleteArticle);
router.post("/:id/publish", verifyToken, isAdmin, newsController.publishArticle);
router.post("/:id/unpublish", verifyToken, isAdmin, newsController.unpublishArticle);

export default router;