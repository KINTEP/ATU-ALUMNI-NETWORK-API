// src/controllers/newsController.js
import pool from "../config/db.js";

const newsController = {

    getAllArticles: async (req, res) => {
        try {
            const { category, is_featured, tags, search, page=1, limit=20, sort_by='published_at', sort_order='DESC' } = req.query;
            const currentUserId = req.user?.id || req.user?.userId || 0;

            let queryText = `SELECT na.*, u.first_name || ' ' || u.last_name as author_name, u.profile_picture as author_picture FROM news_articles na LEFT JOIN users u ON na.author_id=u.id WHERE na.is_published=true`;
            const queryParams = [];
            let p = 0;

            if (category) { p++; queryText += ` AND na.category=$${p}`; queryParams.push(category); }
            if (is_featured === 'true') queryText += ` AND na.is_featured=true`;
            if (tags) { p++; queryText += ` AND na.tags && $${p}::text[]`; queryParams.push(`{${tags}}`); }
            if (search) { p++; queryText += ` AND (na.title ILIKE $${p} OR na.excerpt ILIKE $${p} OR na.content ILIKE $${p})`; queryParams.push(`%${search}%`); }

            const countResult = await pool.query(queryText.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM'), queryParams);
            const totalArticles = parseInt(countResult.rows[0].count);

            const validSortFields = ['published_at','created_at','views_count','likes_count','comments_count','title'];
            const sortField = validSortFields.includes(sort_by) ? sort_by : 'published_at';
            const order = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const offset = (page-1)*limit;

            p++; queryText += ` ORDER BY na.${sortField} ${order} LIMIT $${p}`; queryParams.push(parseInt(limit));
            p++; queryText += ` OFFSET $${p}`; queryParams.push(offset);

            const result = await pool.query(queryText, queryParams);

            // ✅ Check like status using token user, not query param
            const articlesWithLikeStatus = await Promise.all(
                result.rows.map(async (article) => {
                    let userHasLiked = false;
                    if (currentUserId && currentUserId !== 0) {
                        const likeCheck = await pool.query('SELECT id FROM news_likes WHERE news_id=$1 AND user_id=$2', [article.id, currentUserId]);
                        userHasLiked = likeCheck.rows.length > 0;
                    }
                    return { ...article, user_has_liked: userHasLiked };
                })
            );

            res.status(200).json({ success: true, count: articlesWithLikeStatus.length, total: totalArticles, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(totalArticles/limit) }, data: articlesWithLikeStatus });
        } catch (error) {
            console.error("Get articles error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch articles" });
        }
    },

    getFeaturedArticles: async (req, res) => {
        try {
            const { limit=5 } = req.query;
            const result = await pool.query(`SELECT na.*, u.first_name || ' ' || u.last_name as author_name FROM news_articles na LEFT JOIN users u ON na.author_id=u.id WHERE na.is_published=true AND na.is_featured=true ORDER BY na.published_at DESC LIMIT $1`, [parseInt(limit)]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch featured articles" });
        }
    },

    getLatestArticles: async (req, res) => {
        try {
            const { limit=10 } = req.query;
            const result = await pool.query(`SELECT na.*, u.first_name || ' ' || u.last_name as author_name FROM news_articles na LEFT JOIN users u ON na.author_id=u.id WHERE na.is_published=true ORDER BY na.published_at DESC LIMIT $1`, [parseInt(limit)]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch latest articles" });
        }
    },

    getPopularArticles: async (req, res) => {
        try {
            const { limit=10 } = req.query;
            const result = await pool.query(`SELECT na.*, u.first_name || ' ' || u.last_name as author_name FROM news_articles na LEFT JOIN users u ON na.author_id=u.id WHERE na.is_published=true ORDER BY na.views_count DESC, na.likes_count DESC LIMIT $1`, [parseInt(limit)]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch popular articles" });
        }
    },

    getArticleById: async (req, res) => {
        try {
            const { id } = req.params;
            const currentUserId = req.user?.id || req.user?.userId || 0;
            const result = await pool.query(`SELECT na.*, u.first_name || ' ' || u.last_name as author_name, u.email as author_email, u.profile_picture as author_picture, u.role as author_role FROM news_articles na LEFT JOIN users u ON na.author_id=u.id WHERE na.id=$1 AND na.is_published=true`, [id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            let userHasLiked = false;
            if (currentUserId && currentUserId !== 0) {
                const likeCheck = await pool.query('SELECT id FROM news_likes WHERE news_id=$1 AND user_id=$2', [id, currentUserId]);
                userHasLiked = likeCheck.rows.length > 0;
            }
            res.status(200).json({ success: true, data: { ...result.rows[0], user_has_liked: userHasLiked, user_is_subscribed: false } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch article" });
        }
    },

    getArticleBySlug: async (req, res) => {
        try {
            const { slug } = req.params;
            const currentUserId = req.user?.id || req.user?.userId || 0;
            const result = await pool.query(`SELECT na.*, u.first_name || ' ' || u.last_name as author_name, u.email as author_email, u.profile_picture as author_picture FROM news_articles na LEFT JOIN users u ON na.author_id=u.id WHERE na.slug=$1 AND na.is_published=true`, [slug]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            let userHasLiked = false;
            if (currentUserId && currentUserId !== 0) {
                const likeCheck = await pool.query('SELECT id FROM news_likes WHERE news_id=$1 AND user_id=$2', [result.rows[0].id, currentUserId]);
                userHasLiked = likeCheck.rows.length > 0;
            }
            res.status(200).json({ success: true, data: { ...result.rows[0], user_has_liked: userHasLiked } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch article" });
        }
    },

    createArticle: async (req, res) => {
        try {
            // ✅ FIX: was req.body.author_id
            const author_id = req.user.id || req.user.userId;
            const { title, slug, excerpt, content, featured_image, category, tags, meta_description, keywords, is_featured, is_published } = req.body;

            if (!title || !slug || !excerpt || !content || !category) return res.status(400).json({ success: false, error: "Title, slug, excerpt, content, and category are required" });
            if (excerpt.length < 10) return res.status(400).json({ success: false, error: "Excerpt must be at least 10 characters" });
            if (content.length < 50) return res.status(400).json({ success: false, error: "Content must be at least 50 characters" });
            if (meta_description && meta_description.length > 160) return res.status(400).json({ success: false, error: "Meta description must be less than 160 characters" });

            const validCategories = ['Academic','Career','Social','Alumni','University','General'];
            if (!validCategories.includes(category)) return res.status(400).json({ success: false, error: `Category must be one of: ${validCategories.join(', ')}` });

            const slugCheck = await pool.query("SELECT id FROM news_articles WHERE slug=$1", [slug]);
            if (slugCheck.rows.length > 0) return res.status(409).json({ success: false, error: "Article with this slug already exists" });

            const result = await pool.query(
                `INSERT INTO news_articles (author_id,title,slug,excerpt,content,featured_image,category,tags,meta_description,keywords,is_featured,is_published) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
                [author_id, title, slug, excerpt, content, featured_image||null, category, tags||null, meta_description||null, keywords||null, is_featured||false, is_published!==undefined?is_published:true]
            );
            res.status(201).json({ success: true, message: "Article created successfully", data: result.rows[0] });
        } catch (error) {
            console.error("Create article error:", error);
            if (error.code === '22001') return res.status(400).json({ success: false, error: "One or more fields exceed the maximum allowed length" });
            if (error.code === '23505') return res.status(409).json({ success: false, error: "An article with this slug already exists" });
            res.status(500).json({ success: false, error: "Failed to create article" });
        }
    },

    updateArticle: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: added meta_description and keywords to allowed fields
            const allowedFields = ['title','slug','excerpt','content','featured_image','category','tags','meta_description','keywords','is_featured','is_published'];
            const updates = [], values = [];
            let p = 0;
            Object.keys(req.body).forEach(key => { if (allowedFields.includes(key)) { p++; updates.push(`${key} = $${p}`); values.push(req.body[key]); } });
            if (updates.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });
            values.push(id); p++;
            const result = await pool.query(`UPDATE news_articles SET ${updates.join(', ')} WHERE id=$${p} RETURNING *`, values);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            res.status(200).json({ success: true, message: "Article updated successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update article" });
        }
    },

    deleteArticle: async (req, res) => {
        try {
            const result = await pool.query("DELETE FROM news_articles WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            res.status(200).json({ success: true, message: "Article deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete article" });
        }
    },

    incrementViewCount: async (req, res) => {
        try {
            await pool.query("UPDATE news_articles SET views_count=views_count+1 WHERE id=$1", [req.params.id]);
            res.status(200).json({ success: true, message: "View count updated" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update view count" });
        }
    },

    likeArticle: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const existingLike = await pool.query("SELECT id FROM news_likes WHERE news_id=$1 AND user_id=$2", [id, userId]);
            if (existingLike.rows.length > 0) return res.status(409).json({ success: false, error: "Article already liked" });
            await pool.query("INSERT INTO news_likes (news_id,user_id) VALUES ($1,$2)", [id, userId]);
            const articleResult = await pool.query("SELECT likes_count FROM news_articles WHERE id=$1", [id]);
            res.status(201).json({ success: true, message: "Article liked successfully", data: { likes_count: articleResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to like article" });
        }
    },

    unlikeArticle: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query("DELETE FROM news_likes WHERE news_id=$1 AND user_id=$2 RETURNING *", [id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Like not found" });
            const articleResult = await pool.query("SELECT likes_count FROM news_articles WHERE id=$1", [id]);
            res.status(200).json({ success: true, message: "Article unliked successfully", data: { likes_count: articleResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to unlike article" });
        }
    },

    publishArticle: async (req, res) => {
        try {
            const result = await pool.query("UPDATE news_articles SET is_published=true WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            res.status(200).json({ success: true, message: "Article published successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to publish article" });
        }
    },

    unpublishArticle: async (req, res) => {
        try {
            const result = await pool.query("UPDATE news_articles SET is_published=false WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            res.status(200).json({ success: true, message: "Article unpublished successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to unpublish article" });
        }
    },

    // ==================== COMMENTS ====================

    getArticleComments: async (req, res) => {
        try {
            const { id } = req.params;
            const { page=1, limit=50 } = req.query;
            const currentUserId = req.user?.id || req.user?.userId || 0;
            const offset = (page-1)*limit;
            const result = await pool.query(`SELECT nc.*, u.first_name || ' ' || u.last_name as author_name, u.profile_picture as author_picture, (SELECT COUNT(*)>0 FROM news_comment_likes WHERE comment_id=nc.id AND user_id=$3) as user_has_liked FROM news_comments nc LEFT JOIN users u ON nc.user_id=u.id WHERE nc.news_id=$1 AND nc.is_deleted=false ORDER BY nc.created_at DESC LIMIT $2 OFFSET $4`, [id, parseInt(limit), currentUserId, offset]);
            const countResult = await pool.query(`SELECT COUNT(*) FROM news_comments WHERE news_id=$1 AND is_deleted=false`, [id]);
            const total = parseInt(countResult.rows[0].count);
            res.status(200).json({ success: true, count: result.rows.length, total, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch comments" });
        }
    },

    addComment: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { comment } = req.body;
            if (!comment || comment.length < 1 || comment.length > 2000) return res.status(400).json({ success: false, error: "Comment must be 1-2000 characters" });
            const articleCheck = await pool.query("SELECT id FROM news_articles WHERE id=$1 AND is_published=true", [id]);
            if (articleCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Article not found" });
            const result = await pool.query(`INSERT INTO news_comments (news_id,user_id,comment) VALUES ($1,$2,$3) RETURNING *`, [id, userId, comment]);
            const userInfo = await pool.query("SELECT first_name, last_name, profile_picture FROM users WHERE id=$1", [userId]);
            res.status(201).json({ success: true, message: "Comment added successfully", data: { ...result.rows[0], ...userInfo.rows[0], user_has_liked: false } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to add comment" });
        }
    },

    updateComment: async (req, res) => {
        try {
            const { id, commentId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { comment } = req.body;
            if (!comment) return res.status(400).json({ success: false, error: "Comment is required" });
            const result = await pool.query(`UPDATE news_comments SET comment=$1 WHERE id=$2 AND news_id=$3 AND user_id=$4 RETURNING *`, [comment, commentId, id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Comment not found or no permission" });
            res.status(200).json({ success: true, message: "Comment updated successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update comment" });
        }
    },

    deleteComment: async (req, res) => {
        try {
            const { id, commentId } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query(`UPDATE news_comments SET is_deleted=true,comment='[Comment deleted]' WHERE id=$1 AND news_id=$2 AND user_id=$3 RETURNING *`, [commentId, id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Comment not found or no permission" });
            res.status(200).json({ success: true, message: "Comment deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete comment" });
        }
    },

    likeComment: async (req, res) => {
        try {
            const { commentId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const existingLike = await pool.query("SELECT id FROM news_comment_likes WHERE comment_id=$1 AND user_id=$2", [commentId, userId]);
            if (existingLike.rows.length > 0) return res.status(409).json({ success: false, error: "Comment already liked" });
            await pool.query("INSERT INTO news_comment_likes (comment_id,user_id) VALUES ($1,$2)", [commentId, userId]);
            const commentResult = await pool.query("SELECT likes_count FROM news_comments WHERE id=$1", [commentId]);
            res.status(201).json({ success: true, message: "Comment liked successfully", data: { likes_count: commentResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to like comment" });
        }
    },

    unlikeComment: async (req, res) => {
        try {
            const { commentId } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query("DELETE FROM news_comment_likes WHERE comment_id=$1 AND user_id=$2 RETURNING *", [commentId, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Like not found" });
            const commentResult = await pool.query("SELECT likes_count FROM news_comments WHERE id=$1", [commentId]);
            res.status(200).json({ success: true, message: "Comment unliked successfully", data: { likes_count: commentResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to unlike comment" });
        }
    },

    // ==================== STATISTICS ====================

    getNewsStats: async (req, res) => {
        try {
            const [totalResult, commentsResult, categoryResult, viewedResult, likedResult, recentResult] = await Promise.all([
                pool.query("SELECT COUNT(*) as total FROM news_articles WHERE is_published=true"),
                pool.query("SELECT COUNT(*) as total FROM news_comments WHERE is_deleted=false"),
                pool.query(`SELECT category, COUNT(*) as article_count FROM news_articles WHERE is_published=true GROUP BY category ORDER BY article_count DESC`),
                pool.query(`SELECT id, title, category, views_count, likes_count, comments_count FROM news_articles WHERE is_published=true ORDER BY views_count DESC LIMIT 10`),
                pool.query(`SELECT id, title, category, views_count, likes_count, comments_count FROM news_articles WHERE is_published=true ORDER BY likes_count DESC LIMIT 10`),
                pool.query(`SELECT COUNT(*) as new_articles FROM news_articles WHERE is_published=true AND published_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'`)
            ]);
            res.status(200).json({ success: true, data: { total_articles: parseInt(totalResult.rows[0].total), total_comments: parseInt(commentsResult.rows[0].total), new_articles_last_month: parseInt(recentResult.rows[0].new_articles), articles_by_category: categoryResult.rows, most_viewed_articles: viewedResult.rows, most_liked_articles: likedResult.rows } });
        } catch (error) {
            console.error("Get news stats error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch news statistics" });
        }
    }
};

export default newsController;