// src/middlewares/authMiddleware.js
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

// ==================== VERIFY JWT TOKEN ====================
export const verifyToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: "No token provided. Authorization required."
            });
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const userResult = await pool.query(
            "SELECT id, email, role, is_active, is_verified FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(401).json({
                success: false,
                error: "User not found. Invalid token."
            });
        }

        const user = userResult.rows[0];

        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                error: "Account is deactivated. Please contact support."
            });
        }

        req.user = {
            id: user.id,
            userId: user.id,
            email: user.email,
            role: user.role,
            is_verified: user.is_verified
        };

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: "Invalid token. Please login again."
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: "Token expired. Please login again."
            });
        }

        console.error("Auth middleware error:", error);
        res.status(500).json({
            success: false,
            error: "Authentication failed"
        });
    }
};

// ==================== CHECK IF USER IS ADMIN ====================
export const isAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "Authentication required"
        });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: "Access denied. Admin privileges required."
        });
    }

    next();
};

// ==================== CHECK IF USER IS VERIFIED ====================
export const isVerified = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "Authentication required"
        });
    }

    if (!req.user.is_verified) {
        return res.status(403).json({
            success: false,
            error: "Email verification required. Please verify your email."
        });
    }

    next();
};

// ==================== OPTIONAL AUTH (DOESN'T FAIL IF NO TOKEN) ====================
export const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            req.user = null;
            return next();
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const userResult = await pool.query(
            "SELECT id, email, role, is_active, is_verified FROM users WHERE id = $1",
            [decoded.userId]
        );

        if (userResult.rows.length > 0 && userResult.rows[0].is_active) {
            const user = userResult.rows[0];
            req.user = {
                id: user.id,
                userId: user.id,
                email: user.email,
                role: user.role,
                is_verified: user.is_verified
            };
        } else {
            req.user = null;
        }

        next();
    } catch (error) {
        req.user = null;
        next();
    }
};

// ==================== CHECK IF USER OWNS THEIR PROFILE OR IS ADMIN ====================
/**
 * Check if user is updating their own profile or is an admin.
 * Used for: Profile updates, password changes.
 *
 * @example
 * router.put("/:id", verifyToken, isOwnerOrAdmin, userController.updateUser);
 */
export const isOwnerOrAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "Authentication required"
        });
    }

    const resourceUserId = parseInt(req.params.id || req.params.user_id);
    const currentUserId = parseInt(req.user.id);

    if (currentUserId === resourceUserId || req.user.role === 'admin') {
        return next();
    }

    return res.status(403).json({
        success: false,
        error: "You don't have permission to perform this action"
    });
};

// ==================== CHECK RESOURCE OWNERSHIP ====================
/**
 * Check if user owns a resource OR is admin.
 *
 * Supported resource types:
 *   - 'forum_post'      → forum_posts table
 *   - 'forum_reply'     → forum_replies table
 *   - 'event_comment'   → event_comments table
 *   - 'news_comment'    → news_comments table
 *   - 'tracer_study'    → tracer_study_responses table
 *
 * NOT used for: Events, jobs, news articles (those are admin-only create/edit).
 *
 * @param {string} resourceType  - One of the types listed above
 * @param {string} idParamName   - Route param containing the resource ID (default: 'id')
 *
 * @example
 * router.put("/posts/:id", verifyToken, checkResourceOwnership('forum_post'), forumController.updatePost);
 * router.put("/:id/comments/:commentId", verifyToken, checkResourceOwnership('event_comment', 'commentId'), eventController.updateComment);
 */
export const checkResourceOwnership = (resourceType, idParamName = 'id') => async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "Authentication required"
        });
    }

    // Admin can do anything
    if (req.user.role === 'admin') {
        return next();
    }

    const resourceId = req.params[idParamName] || req.params.commentId || req.params.replyId;
    const userId = parseInt(req.user.id);

    if (!resourceId) {
        return res.status(400).json({
            success: false,
            error: "Resource ID not provided"
        });
    }

    const resourceQueries = {
        'forum_post': {
            query: 'SELECT user_id FROM forum_posts WHERE id = $1',
            name: 'post'
        },
        'forum_reply': {
            query: 'SELECT user_id FROM forum_replies WHERE id = $1',
            name: 'reply'
        },
        'event_comment': {
            query: 'SELECT user_id FROM event_comments WHERE id = $1',
            name: 'comment'
        },
        'news_comment': {
            query: 'SELECT user_id FROM news_comments WHERE id = $1',
            name: 'comment'
        },
        'tracer_study': {
            query: 'SELECT user_id FROM tracer_study_responses WHERE id = $1',
            name: 'response'
        }
    };

    const resourceConfig = resourceQueries[resourceType];

    if (!resourceConfig) {
        console.error(`Invalid resource type: ${resourceType}`);
        return res.status(400).json({
            success: false,
            error: 'Invalid resource type'
        });
    }

    try {
        const result = await pool.query(resourceConfig.query, [resourceId]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: `${resourceConfig.name.charAt(0).toUpperCase() + resourceConfig.name.slice(1)} not found`
            });
        }

        // ✅ FIX: parseInt on both sides — DB may return user_id as string
        // depending on pg driver version and column type
        const ownerId = parseInt(result.rows[0].user_id);

        if (ownerId === userId) {
            return next();
        }

        return res.status(403).json({
            success: false,
            error: `You don't have permission to modify this ${resourceConfig.name}`
        });
    } catch (error) {
        console.error(`Resource ownership check error for ${resourceType}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to verify ownership'
        });
    }
};

// ==================== CHECK POST AUTHOR (FOR MARKING SOLUTIONS) ====================
/**
 * Check if user is the original post author.
 * Used only for marking forum replies as solutions.
 *
 * @example
 * router.post("/:id/replies/:replyId/solution", verifyToken, isPostAuthor, forumController.markAsSolution);
 */
export const isPostAuthor = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            success: false,
            error: "Authentication required"
        });
    }

    const postId = req.params.id;
    const userId = parseInt(req.user.id);

    try {
        const result = await pool.query(
            'SELECT user_id FROM forum_posts WHERE id = $1',
            [postId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Post not found'
            });
        }

        // ✅ FIX: parseInt on DB value — user_id may return as string from pg driver
        if (parseInt(result.rows[0].user_id) === userId || req.user.role === 'admin') {
            return next();
        }

        return res.status(403).json({
            success: false,
            error: "Only the post author can mark solutions"
        });
    } catch (error) {
        console.error('Post author check error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to verify post ownership'
        });
    }
};