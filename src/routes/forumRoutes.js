// src/routes/forumRoutes.js
import express from "express";
import forumController from "../controllers/forumController.js";
import { verifyToken, isAdmin, optionalAuth } from "../middlewares/authMiddleware.js";

const router = express.Router();

// ==================== CATEGORIES ====================
// Public routes
router.get("/categories", forumController.getAllCategories);
router.get("/categories/:id", optionalAuth, forumController.getCategoryById);

// Admin only
router.post("/categories", verifyToken, isAdmin, forumController.createCategory);
router.put("/categories/:id", verifyToken, isAdmin, forumController.updateCategory);
router.delete("/categories/:id", verifyToken, isAdmin, forumController.deleteCategory);

// ==================== POSTS ====================
// Public routes (can browse without login)
router.get("/posts", optionalAuth, forumController.getAllPosts);
router.get("/posts/popular", optionalAuth, forumController.getPopularPosts);
router.get("/posts/trending", optionalAuth, forumController.getTrendingPosts);
router.get("/posts/my-posts", verifyToken, forumController.getMyPosts);
router.get("/posts/:id", optionalAuth, forumController.getPostById);
router.get("/posts/:id/replies", optionalAuth, forumController.getPostReplies);
router.get("/posts/:id/replies/:replyId/nested", optionalAuth, forumController.getNestedReplies);

// Protected routes (authentication required)
router.post("/posts", verifyToken, forumController.createPost);
router.put("/posts/:id", verifyToken, forumController.updatePost); // Owner only
router.delete("/posts/:id", verifyToken, forumController.deletePost); // Owner or admin

// Post actions (authentication required)
router.post("/posts/:id/view", optionalAuth, forumController.incrementPostViews); // Track for guests too
router.post("/posts/:id/like", verifyToken, forumController.likePost);
router.delete("/posts/:id/unlike", verifyToken, forumController.unlikePost);
router.post("/posts/:id/subscribe", verifyToken, forumController.subscribeToPost);
router.delete("/posts/:id/unsubscribe", verifyToken, forumController.unsubscribeFromPost);

// Admin actions
router.post("/posts/:id/pin", verifyToken, isAdmin, forumController.pinPost);
router.post("/posts/:id/unpin", verifyToken, isAdmin, forumController.unpinPost);
router.post("/posts/:id/lock", verifyToken, isAdmin, forumController.lockPost);
router.post("/posts/:id/unlock", verifyToken, isAdmin, forumController.unlockPost);

// ==================== REPLIES ====================
// Protected routes (authentication required)
router.post("/posts/:id/replies", verifyToken, forumController.addReply);
router.post("/posts/:id/replies/:replyId/reply", verifyToken, forumController.replyToReply);
router.put("/posts/:id/replies/:replyId", verifyToken, forumController.updateReply); // Owner only
router.delete("/posts/:id/replies/:replyId", verifyToken, forumController.deleteReply); // Owner or admin
router.post("/posts/:id/replies/:replyId/like", verifyToken, forumController.likeReply);
router.delete("/posts/:id/replies/:replyId/unlike", verifyToken, forumController.unlikeReply);
router.post("/posts/:id/replies/:replyId/solution", verifyToken, forumController.markAsSolution); // Post owner only

// ==================== STATISTICS ====================
router.get("/stats", forumController.getForumStats);

export default router;