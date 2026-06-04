// src/controllers/forumController.js
import pool from "../config/db.js";

const forumController = {

    // ==================== CATEGORIES ====================

    getAllCategories: async (req, res) => {
        try {
            const result = await pool.query(`SELECT * FROM forum_categories WHERE is_active = true ORDER BY order_position ASC, name ASC`);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            console.error("Get categories error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch categories" });
        }
    },

    getCategoryById: async (req, res) => {
        try {
            const result = await pool.query("SELECT * FROM forum_categories WHERE id = $1 AND is_active = true", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Category not found" });
            res.status(200).json({ success: true, data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch category" });
        }
    },

    createCategory: async (req, res) => {
        try {
            const { name, slug, description, icon, color, order_position } = req.body;
            if (!name || !slug || !description) return res.status(400).json({ success: false, error: "Name, slug, and description are required" });
            const slugCheck = await pool.query("SELECT id FROM forum_categories WHERE slug = $1", [slug]);
            if (slugCheck.rows.length > 0) return res.status(409).json({ success: false, error: "Category with this slug already exists" });
            const result = await pool.query(`INSERT INTO forum_categories (name,slug,description,icon,color,order_position) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [name, slug, description, icon||null, color||null, order_position||0]);
            res.status(201).json({ success: true, message: "Category created successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to create category" });
        }
    },

    updateCategory: async (req, res) => {
        try {
            const { id } = req.params;
            const allowedFields = ['name','slug','description','icon','color','order_position','is_active'];
            const updates = [], values = [];
            let p = 0;
            Object.keys(req.body).forEach(key => { if (allowedFields.includes(key)) { p++; updates.push(`${key} = $${p}`); values.push(req.body[key]); } });
            if (updates.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });
            values.push(id); p++;
            const result = await pool.query(`UPDATE forum_categories SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`, values);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Category not found" });
            res.status(200).json({ success: true, message: "Category updated successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update category" });
        }
    },

    deleteCategory: async (req, res) => {
        try {
            const { id } = req.params;
            const postsCheck = await pool.query("SELECT COUNT(*) FROM forum_posts WHERE category_id = $1", [id]);
            if (parseInt(postsCheck.rows[0].count) > 0) return res.status(400).json({ success: false, error: "Cannot delete category with existing posts" });
            const result = await pool.query("DELETE FROM forum_categories WHERE id = $1 RETURNING *", [id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Category not found" });
            res.status(200).json({ success: true, message: "Category deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete category" });
        }
    },

    // ==================== POSTS ====================

    getAllPosts: async (req, res) => {
        try {
            const { category_id, user_id, tags, is_pinned, search, page=1, limit=20, sort_by='last_activity_at', sort_order='DESC' } = req.query;
            const currentUserId = req.user?.id || req.user?.userId || 0;

            // Build separate count and main queries to avoid param conflicts
            let countWhere = ['fp.is_published = true'];
            const countParams = [];
            let cp = 0;

            let mainWhere = ['fp.is_published = true'];
            const mainParams = [currentUserId]; // $1
            let mp = 1;

            if (category_id) {
                cp++; countWhere.push(`fp.category_id = $${cp}`); countParams.push(category_id);
                mp++; mainWhere.push(`fp.category_id = $${mp}`); mainParams.push(category_id);
            }
            if (user_id) {
                cp++; countWhere.push(`fp.user_id = $${cp}`); countParams.push(user_id);
                mp++; mainWhere.push(`fp.user_id = $${mp}`); mainParams.push(user_id);
            }
            if (is_pinned === 'true') { countWhere.push(`fp.is_pinned = true`); mainWhere.push(`fp.is_pinned = true`); }
            if (tags) {
                cp++; countWhere.push(`fp.tags && $${cp}::text[]`); countParams.push(`{${tags}}`);
                mp++; mainWhere.push(`fp.tags && $${mp}::text[]`); mainParams.push(`{${tags}}`);
            }
            if (search) {
                cp++; countWhere.push(`(fp.title ILIKE $${cp} OR fp.content ILIKE $${cp})`); countParams.push(`%${search}%`);
                mp++; mainWhere.push(`(fp.title ILIKE $${mp} OR fp.content ILIKE $${mp})`); mainParams.push(`%${search}%`);
            }

            const countResult = await pool.query(`SELECT COUNT(*) FROM forum_posts fp WHERE ${countWhere.join(' AND ')}`, countParams);
            const totalPosts = parseInt(countResult.rows[0].count);

            const validSortFields = ['created_at','last_activity_at','views_count','replies_count','likes_count','title'];
            const sortField = validSortFields.includes(sort_by) ? sort_by : 'last_activity_at';
            const order = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const offset = (page-1)*limit;

            mp++; mainParams.push(parseInt(limit));
            mp++; mainParams.push(offset);

            const result = await pool.query(`
                SELECT fp.*, fc.name as category_name, fc.slug as category_slug,
                    u.first_name || ' ' || u.last_name as author_name, u.profile_picture as author_picture,
                    (SELECT COUNT(*)>0 FROM forum_post_likes WHERE post_id=fp.id AND user_id=$1) as user_has_liked
                FROM forum_posts fp
                LEFT JOIN forum_categories fc ON fp.category_id = fc.id
                LEFT JOIN users u ON fp.user_id = u.id
                WHERE ${mainWhere.join(' AND ')}
                ORDER BY fp.is_pinned DESC, fp.${sortField} ${order}
                LIMIT $${mp-1} OFFSET $${mp}
            `, mainParams);

            res.status(200).json({ success: true, count: result.rows.length, total: totalPosts, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(totalPosts/limit) }, data: result.rows });
        } catch (error) {
            console.error("Get posts error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch posts" });
        }
    },

    getPopularPosts: async (req, res) => {
        try {
            const { page=1, limit=10 } = req.query;
            const offset = (page-1)*limit;
            const result = await pool.query(`SELECT fp.*, fc.name as category_name, u.first_name || ' ' || u.last_name as author_name FROM forum_posts fp LEFT JOIN forum_categories fc ON fp.category_id=fc.id LEFT JOIN users u ON fp.user_id=u.id WHERE fp.is_published=true ORDER BY fp.likes_count DESC, fp.views_count DESC LIMIT $1 OFFSET $2`, [parseInt(limit), offset]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch popular posts" });
        }
    },

    getTrendingPosts: async (req, res) => {
        try {
            const { page=1, limit=10 } = req.query;
            const offset = (page-1)*limit;
            const result = await pool.query(`SELECT fp.*, fc.name as category_name, u.first_name || ' ' || u.last_name as author_name FROM forum_posts fp LEFT JOIN forum_categories fc ON fp.category_id=fc.id LEFT JOIN users u ON fp.user_id=u.id WHERE fp.is_published=true AND fp.created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days' ORDER BY (fp.replies_count+fp.likes_count+fp.views_count) DESC LIMIT $1 OFFSET $2`, [parseInt(limit), offset]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch trending posts" });
        }
    },

    getMyPosts: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const { page=1, limit=20 } = req.query;
            const offset = (page-1)*limit;
            const result = await pool.query(`SELECT fp.*, fc.name as category_name FROM forum_posts fp LEFT JOIN forum_categories fc ON fp.category_id=fc.id WHERE fp.user_id=$1 AND fp.is_published=true ORDER BY fp.created_at DESC LIMIT $2 OFFSET $3`, [userId, parseInt(limit), offset]);
            const countResult = await pool.query("SELECT COUNT(*) FROM forum_posts WHERE user_id=$1 AND is_published=true", [userId]);
            const total = parseInt(countResult.rows[0].count);
            res.status(200).json({ success: true, count: result.rows.length, total, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch posts" });
        }
    },

    getPostById: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user?.id || req.user?.userId || 0;
            const result = await pool.query(`SELECT fp.*, fc.name as category_name, fc.slug as category_slug, u.first_name || ' ' || u.last_name as author_name, u.email as author_email, u.profile_picture as author_picture, u.graduation_year as author_graduation_year, (SELECT COUNT(*)>0 FROM forum_post_likes WHERE post_id=fp.id AND user_id=$2) as user_has_liked, (SELECT COUNT(*)>0 FROM forum_subscriptions WHERE post_id=fp.id AND user_id=$2) as user_is_subscribed FROM forum_posts fp LEFT JOIN forum_categories fc ON fp.category_id=fc.id LEFT JOIN users u ON fp.user_id=u.id WHERE fp.id=$1 AND fp.is_published=true`, [id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            res.status(200).json({ success: true, data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch post" });
        }
    },

    createPost: async (req, res) => {
        try {
            const { category_id, title, content, slug, tags } = req.body;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            if (!category_id || !title || !content || !slug) return res.status(400).json({ success: false, error: "Category ID, title, content, and slug are required" });
            if (title.length < 5 || title.length > 255) return res.status(400).json({ success: false, error: "Title must be 5-255 characters" });
            if (content.length < 10) return res.status(400).json({ success: false, error: "Content must be at least 10 characters" });
            const slugCheck = await pool.query("SELECT id FROM forum_posts WHERE slug=$1", [slug]);
            if (slugCheck.rows.length > 0) return res.status(409).json({ success: false, error: "Post with this slug already exists" });
            const categoryCheck = await pool.query("SELECT id FROM forum_categories WHERE id=$1 AND is_active=true", [category_id]);
            if (categoryCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Category not found" });
            const result = await pool.query(`INSERT INTO forum_posts (category_id,user_id,title,content,slug,tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [category_id, userId, title, content, slug, tags||null]);
            res.status(201).json({ success: true, message: "Post created successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to create post" });
        }
    },

    updatePost: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const postCheck = await pool.query("SELECT user_id FROM forum_posts WHERE id=$1", [id]);
            if (postCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            // ✅ FIX: parseInt on both sides to avoid type mismatch
            if (parseInt(postCheck.rows[0].user_id) !== userId) return res.status(403).json({ success: false, error: "You don't have permission to edit this post" });
            const allowedFields = ['title','content','tags'];
            const updates = [], values = [];
            let p = 0;
            Object.keys(req.body).forEach(key => { if (allowedFields.includes(key)) { p++; updates.push(`${key} = $${p}`); values.push(req.body[key]); } });
            if (updates.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });
            values.push(id); p++;
            const result = await pool.query(`UPDATE forum_posts SET ${updates.join(', ')} WHERE id=$${p} RETURNING *`, values);
            res.status(200).json({ success: true, message: "Post updated successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update post" });
        }
    },

    deletePost: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const postCheck = await pool.query("SELECT user_id FROM forum_posts WHERE id=$1", [id]);
            if (postCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            if (parseInt(postCheck.rows[0].user_id) !== userId && req.user.role !== 'admin') return res.status(403).json({ success: false, error: "You don't have permission to delete this post" });
            await pool.query("UPDATE forum_posts SET is_published=false WHERE id=$1", [id]);
            res.status(200).json({ success: true, message: "Post deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete post" });
        }
    },

    incrementPostViews: async (req, res) => {
        try {
            await pool.query("UPDATE forum_posts SET views_count=views_count+1 WHERE id=$1", [req.params.id]);
            res.status(200).json({ success: true, message: "View count updated" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update view count" });
        }
    },

    likePost: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const existingLike = await pool.query("SELECT id FROM forum_post_likes WHERE post_id=$1 AND user_id=$2", [id, userId]);
            if (existingLike.rows.length > 0) return res.status(409).json({ success: false, error: "Post already liked" });
            await pool.query("INSERT INTO forum_post_likes (post_id,user_id) VALUES ($1,$2)", [id, userId]);
            const postResult = await pool.query("SELECT likes_count FROM forum_posts WHERE id=$1", [id]);
            res.status(201).json({ success: true, message: "Post liked successfully", data: { likes_count: postResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to like post" });
        }
    },

    unlikePost: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query("DELETE FROM forum_post_likes WHERE post_id=$1 AND user_id=$2 RETURNING *", [id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Like not found" });
            const postResult = await pool.query("SELECT likes_count FROM forum_posts WHERE id=$1", [id]);
            res.status(200).json({ success: true, message: "Post unliked successfully", data: { likes_count: postResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to unlike post" });
        }
    },

    pinPost: async (req, res) => {
        try {
            const result = await pool.query("UPDATE forum_posts SET is_pinned=true WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            res.status(200).json({ success: true, message: "Post pinned successfully", data: result.rows[0] });
        } catch (error) { res.status(500).json({ success: false, error: "Failed to pin post" }); }
    },

    unpinPost: async (req, res) => {
        try {
            const result = await pool.query("UPDATE forum_posts SET is_pinned=false WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            res.status(200).json({ success: true, message: "Post unpinned successfully", data: result.rows[0] });
        } catch (error) { res.status(500).json({ success: false, error: "Failed to unpin post" }); }
    },

    lockPost: async (req, res) => {
        try {
            const result = await pool.query("UPDATE forum_posts SET is_locked=true WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            res.status(200).json({ success: true, message: "Post locked successfully", data: result.rows[0] });
        } catch (error) { res.status(500).json({ success: false, error: "Failed to lock post" }); }
    },

    unlockPost: async (req, res) => {
        try {
            const result = await pool.query("UPDATE forum_posts SET is_locked=false WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            res.status(200).json({ success: true, message: "Post unlocked successfully", data: result.rows[0] });
        } catch (error) { res.status(500).json({ success: false, error: "Failed to unlock post" }); }
    },

    subscribeToPost: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const existingSub = await pool.query("SELECT id FROM forum_subscriptions WHERE post_id=$1 AND user_id=$2", [id, userId]);
            if (existingSub.rows.length > 0) return res.status(409).json({ success: false, error: "Already subscribed" });
            await pool.query("INSERT INTO forum_subscriptions (post_id,user_id) VALUES ($1,$2)", [id, userId]);
            res.status(201).json({ success: true, message: "Subscribed to post successfully" });
        } catch (error) { res.status(500).json({ success: false, error: "Failed to subscribe" }); }
    },

    unsubscribeFromPost: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query("DELETE FROM forum_subscriptions WHERE post_id=$1 AND user_id=$2 RETURNING *", [id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Subscription not found" });
            res.status(200).json({ success: true, message: "Unsubscribed successfully" });
        } catch (error) { res.status(500).json({ success: false, error: "Failed to unsubscribe" }); }
    },

    // ==================== REPLIES ====================

    getPostReplies: async (req, res) => {
        try {
            const { id } = req.params;
            const { page=1, limit=50 } = req.query;
            const currentUserId = req.user?.id || req.user?.userId || 0;
            const offset = (page-1)*limit;
            const result = await pool.query(`SELECT fr.*, u.first_name || ' ' || u.last_name as author_name, u.profile_picture as author_picture, u.graduation_year as author_graduation_year, (SELECT COUNT(*) FROM forum_replies WHERE parent_reply_id=fr.id AND is_deleted=false) as replies_count, (SELECT COUNT(*)>0 FROM forum_reply_likes WHERE reply_id=fr.id AND user_id=$3) as user_has_liked FROM forum_replies fr LEFT JOIN users u ON fr.user_id=u.id WHERE fr.post_id=$1 AND fr.parent_reply_id IS NULL AND fr.is_deleted=false ORDER BY fr.is_solution DESC, fr.created_at ASC LIMIT $2 OFFSET $4`, [id, parseInt(limit), currentUserId, offset]);
            const countResult = await pool.query(`SELECT COUNT(*) FROM forum_replies WHERE post_id=$1 AND parent_reply_id IS NULL AND is_deleted=false`, [id]);
            const total = parseInt(countResult.rows[0].count);
            res.status(200).json({ success: true, count: result.rows.length, total, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch replies" });
        }
    },

    getNestedReplies: async (req, res) => {
        try {
            const { id, replyId } = req.params;
            const currentUserId = req.user?.id || req.user?.userId || 0;
            const result = await pool.query(`SELECT fr.*, u.first_name || ' ' || u.last_name as author_name, u.profile_picture as author_picture, (SELECT COUNT(*)>0 FROM forum_reply_likes WHERE reply_id=fr.id AND user_id=$3) as user_has_liked FROM forum_replies fr LEFT JOIN users u ON fr.user_id=u.id WHERE fr.parent_reply_id=$1 AND fr.post_id=$2 AND fr.is_deleted=false ORDER BY fr.created_at ASC`, [replyId, id, currentUserId]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch nested replies" });
        }
    },

    addReply: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { content } = req.body;
            if (!content) return res.status(400).json({ success: false, error: "Content is required" });
            if (content.length < 1 || content.length > 10000) return res.status(400).json({ success: false, error: "Content must be 1-10000 characters" });
            const postCheck = await pool.query("SELECT is_locked FROM forum_posts WHERE id=$1 AND is_published=true", [id]);
            if (postCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            if (postCheck.rows[0].is_locked) return res.status(403).json({ success: false, error: "Post is locked" });
            const result = await pool.query(`INSERT INTO forum_replies (post_id,user_id,content) VALUES ($1,$2,$3) RETURNING *`, [id, userId, content]);
            const userInfo = await pool.query("SELECT first_name, last_name, profile_picture FROM users WHERE id=$1", [userId]);
            res.status(201).json({ success: true, message: "Reply added successfully", data: { ...result.rows[0], author_name: `${userInfo.rows[0].first_name} ${userInfo.rows[0].last_name}`, author_picture: userInfo.rows[0].profile_picture, replies_count: 0, user_has_liked: false } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to add reply" });
        }
    },

    replyToReply: async (req, res) => {
        try {
            const { id, replyId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { content } = req.body;
            if (!content) return res.status(400).json({ success: false, error: "Content is required" });
            const replyCheck = await pool.query("SELECT id FROM forum_replies WHERE id=$1 AND post_id=$2", [replyId, id]);
            if (replyCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Parent reply not found" });
            const postCheck = await pool.query("SELECT is_locked FROM forum_posts WHERE id=$1", [id]);
            if (postCheck.rows[0].is_locked) return res.status(403).json({ success: false, error: "Post is locked" });
            const result = await pool.query(`INSERT INTO forum_replies (post_id,user_id,parent_reply_id,content) VALUES ($1,$2,$3,$4) RETURNING *`, [id, userId, replyId, content]);
            const userInfo = await pool.query("SELECT first_name, last_name, profile_picture FROM users WHERE id=$1", [userId]);
            res.status(201).json({ success: true, message: "Reply added successfully", data: { ...result.rows[0], author_name: `${userInfo.rows[0].first_name} ${userInfo.rows[0].last_name}`, author_picture: userInfo.rows[0].profile_picture, user_has_liked: false } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to add reply" });
        }
    },

    updateReply: async (req, res) => {
        try {
            const { id, replyId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { content } = req.body;
            if (!content) return res.status(400).json({ success: false, error: "Content is required" });
            const result = await pool.query(`UPDATE forum_replies SET content=$1 WHERE id=$2 AND post_id=$3 AND user_id=$4 RETURNING *`, [content, replyId, id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Reply not found or no permission" });
            res.status(200).json({ success: true, message: "Reply updated successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update reply" });
        }
    },

    deleteReply: async (req, res) => {
        try {
            const { id, replyId } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const result = await pool.query(`UPDATE forum_replies SET is_deleted=true,content='[Reply deleted]' WHERE id=$1 AND post_id=$2 AND user_id=$3 RETURNING *`, [replyId, id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Reply not found or no permission" });
            res.status(200).json({ success: true, message: "Reply deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete reply" });
        }
    },

    likeReply: async (req, res) => {
        try {
            const { replyId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const existingLike = await pool.query("SELECT id FROM forum_reply_likes WHERE reply_id=$1 AND user_id=$2", [replyId, userId]);
            if (existingLike.rows.length > 0) return res.status(409).json({ success: false, error: "Reply already liked" });
            await pool.query("INSERT INTO forum_reply_likes (reply_id,user_id) VALUES ($1,$2)", [replyId, userId]);
            const replyResult = await pool.query("SELECT likes_count FROM forum_replies WHERE id=$1", [replyId]);
            res.status(201).json({ success: true, message: "Reply liked successfully", data: { likes_count: replyResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to like reply" });
        }
    },

    unlikeReply: async (req, res) => {
        try {
            const { replyId } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query("DELETE FROM forum_reply_likes WHERE reply_id=$1 AND user_id=$2 RETURNING *", [replyId, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Like not found" });
            const replyResult = await pool.query("SELECT likes_count FROM forum_replies WHERE id=$1", [replyId]);
            res.status(200).json({ success: true, message: "Reply unliked successfully", data: { likes_count: replyResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to unlike reply" });
        }
    },

    markAsSolution: async (req, res) => {
        try {
            const { id, replyId } = req.params;
            // ✅ FIX: was req.body.user_id; also parseInt on both sides
            const userId = parseInt(req.user.id || req.user.userId);
            const postCheck = await pool.query("SELECT user_id FROM forum_posts WHERE id=$1", [id]);
            if (postCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Post not found" });
            // ✅ FIX: parseInt on DB value to avoid type mismatch
            if (parseInt(postCheck.rows[0].user_id) !== userId) return res.status(403).json({ success: false, error: "Only the post author can mark a solution" });
            await pool.query("UPDATE forum_replies SET is_solution=false WHERE post_id=$1", [id]);
            const result = await pool.query("UPDATE forum_replies SET is_solution=true WHERE id=$1 AND post_id=$2 RETURNING *", [replyId, id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Reply not found" });
            res.status(200).json({ success: true, message: "Reply marked as solution", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to mark solution" });
        }
    },

    // ==================== STATISTICS ====================

    getForumStats: async (req, res) => {
        try {
            const [postsResult, repliesResult, categoriesResult, postsByCategoryResult, activeUsersResult, popularPostsResult, recentResult] = await Promise.all([
                pool.query("SELECT COUNT(*) as total FROM forum_posts WHERE is_published=true"),
                pool.query("SELECT COUNT(*) as total FROM forum_replies WHERE is_deleted=false"),
                pool.query("SELECT COUNT(*) as total FROM forum_categories WHERE is_active=true"),
                pool.query(`SELECT fc.name as category_name, COUNT(fp.id) as post_count FROM forum_categories fc LEFT JOIN forum_posts fp ON fc.id=fp.category_id AND fp.is_published=true WHERE fc.is_active=true GROUP BY fc.name ORDER BY post_count DESC`),
                pool.query(`SELECT u.first_name || ' ' || u.last_name as user_name, COUNT(fp.id) as post_count FROM users u JOIN forum_posts fp ON u.id=fp.user_id WHERE fp.is_published=true GROUP BY u.id, user_name ORDER BY post_count DESC LIMIT 10`),
                pool.query(`SELECT id, title, views_count, replies_count, likes_count FROM forum_posts WHERE is_published=true ORDER BY (views_count+replies_count+likes_count) DESC LIMIT 10`),
                pool.query(`SELECT COUNT(*) as new_posts FROM forum_posts WHERE is_published=true AND created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`)
            ]);
            res.status(200).json({ success: true, data: { total_posts: parseInt(postsResult.rows[0].total), total_replies: parseInt(repliesResult.rows[0].total), total_categories: parseInt(categoriesResult.rows[0].total), new_posts_last_week: parseInt(recentResult.rows[0].new_posts), posts_by_category: postsByCategoryResult.rows, most_active_users: activeUsersResult.rows, most_popular_posts: popularPostsResult.rows } });
        } catch (error) {
            console.error("Get forum stats error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch forum statistics" });
        }
    }
};

export default forumController;