// src/controllers/messageController.js
import pool from "../config/db.js";

// ✅ All methods use req.user.id (set by verifyToken middleware) instead of
// client-supplied user_id from req.body or req.query. This prevents any
// authenticated user from impersonating another by passing a different user_id.

const messageController = {

    // ==================== CONVERSATIONS ====================

    // Get all conversations for current user
    getUserConversations: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id — anyone could read anyone's conversations
            const userId = parseInt(req.user.id || req.user.userId);
            const { archived = 'false' } = req.query;
            const showArchived = archived === 'true';

            const result = await pool.query(`
                SELECT 
                    conversation_id,
                    CASE WHEN user1_id = $1 THEN other_user_id_for_user1
                         ELSE other_user_id_for_user2 END as other_user_id,
                    CASE WHEN user1_id = $1 THEN other_user_name_for_user1
                         ELSE other_user_name_for_user2 END as other_user_name,
                    CASE WHEN user1_id = $1 THEN other_user_picture_for_user1
                         ELSE other_user_picture_for_user2 END as other_user_picture,
                    CASE WHEN user1_id = $1 THEN unread_count_for_user1
                         ELSE unread_count_for_user2 END as unread_count,
                    CASE WHEN user1_id = $1 THEN is_archived_by_user1
                         ELSE is_archived_by_user2 END as is_archived,
                    CASE WHEN user1_id = $1 THEN is_blocked_by_user1
                         ELSE is_blocked_by_user2 END as is_blocked,
                    last_message_at,
                    last_message_preview,
                    conversation_created_at
                FROM v_user_conversations
                WHERE (user1_id = $1 OR user2_id = $1)
                AND (
                    CASE WHEN user1_id = $1 THEN is_archived_by_user1
                         ELSE is_archived_by_user2 END = $2
                )
                ORDER BY last_message_at DESC NULLS LAST
            `, [userId, showArchived]);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                data: result.rows
            });

        } catch (error) {
            console.error("Get conversations error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch conversations" });
        }
    },

    // Get or create conversation between two users
    getOrCreateConversation: async (req, res) => {
        try {
            // ✅ FIX: current user is always one side of the conversation
            const currentUserId = parseInt(req.user.id || req.user.userId);
            const { other_user_id } = req.body;

            if (!other_user_id) {
                return res.status(400).json({
                    success: false,
                    error: "other_user_id is required"
                });
            }

            const otherUserId = parseInt(other_user_id);

            if (currentUserId === otherUserId) {
                return res.status(400).json({
                    success: false,
                    error: "Cannot create conversation with yourself"
                });
            }

            // Ensure consistent ordering (user1_id always < user2_id)
            const [smallerId, largerId] = currentUserId < otherUserId
                ? [currentUserId, otherUserId]
                : [otherUserId, currentUserId];

            // Try to get existing conversation
            let result = await pool.query(
                `SELECT 
                    c.*,
                    u1.first_name || ' ' || u1.last_name as user1_name,
                    u1.profile_picture as user1_picture,
                    u2.first_name || ' ' || u2.last_name as user2_name,
                    u2.profile_picture as user2_picture
                FROM conversations c
                JOIN users u1 ON c.user1_id = u1.id
                JOIN users u2 ON c.user2_id = u2.id
                WHERE c.user1_id = $1 AND c.user2_id = $2`,
                [smallerId, largerId]
            );

            if (result.rows.length === 0) {
                const newConv = await pool.query(
                    `INSERT INTO conversations (user1_id, user2_id) VALUES ($1, $2) RETURNING *`,
                    [smallerId, largerId]
                );

                const userDetails = await pool.query(
                    `SELECT 
                        u1.first_name || ' ' || u1.last_name as user1_name,
                        u1.profile_picture as user1_picture,
                        u2.first_name || ' ' || u2.last_name as user2_name,
                        u2.profile_picture as user2_picture
                    FROM users u1, users u2
                    WHERE u1.id = $1 AND u2.id = $2`,
                    [smallerId, largerId]
                );

                result = { rows: [{ ...newConv.rows[0], ...userDetails.rows[0] }] };
            }

            res.status(200).json({ success: true, data: result.rows[0] });

        } catch (error) {
            console.error("Get/create conversation error:", error);
            res.status(500).json({ success: false, error: "Failed to get or create conversation" });
        }
    },

    // Get single conversation details
    getConversationById: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;

            const result = await pool.query(`
                SELECT 
                    c.*,
                    u1.first_name || ' ' || u1.last_name as user1_name,
                    u1.profile_picture as user1_picture,
                    u1.email as user1_email,
                    u2.first_name || ' ' || u2.last_name as user2_name,
                    u2.profile_picture as user2_picture,
                    u2.email as user2_email
                FROM conversations c
                JOIN users u1 ON c.user1_id = u1.id
                JOIN users u2 ON c.user2_id = u2.id
                WHERE c.id = $1 AND (c.user1_id = $2 OR c.user2_id = $2)
            `, [id, userId]);

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Conversation not found or you don't have access"
                });
            }

            res.status(200).json({ success: true, data: result.rows[0] });

        } catch (error) {
            console.error("Get conversation error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch conversation" });
        }
    },

    // ==================== ARCHIVE / UNARCHIVE / BLOCK / UNBLOCK ====================
    // Shared helper to update a boolean flag on a conversation for the current user

    archiveConversation: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;
            await _updateConversationFlag(id, userId, 'is_archived', true, res);
        } catch (error) {
            console.error("Archive error:", error);
            res.status(500).json({ success: false, error: "Failed to archive conversation" });
        }
    },

    unarchiveConversation: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;
            await _updateConversationFlag(id, userId, 'is_archived', false, res);
        } catch (error) {
            console.error("Unarchive error:", error);
            res.status(500).json({ success: false, error: "Failed to unarchive conversation" });
        }
    },

    blockConversation: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;
            await _updateConversationFlag(id, userId, 'is_blocked', true, res);
        } catch (error) {
            console.error("Block error:", error);
            res.status(500).json({ success: false, error: "Failed to block user" });
        }
    },

    unblockConversation: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;
            await _updateConversationFlag(id, userId, 'is_blocked', false, res);
        } catch (error) {
            console.error("Unblock error:", error);
            res.status(500).json({ success: false, error: "Failed to unblock user" });
        }
    },

    // Delete conversation (soft delete — marks messages as deleted for this user)
    deleteConversation: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;

            const convCheck = await pool.query(
                "SELECT user1_id, user2_id FROM conversations WHERE id = $1",
                [id]
            );

            if (convCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Conversation not found" });
            }

            const conv = convCheck.rows[0];
            if (conv.user1_id !== userId && conv.user2_id !== userId) {
                return res.status(403).json({ success: false, error: "Access denied" });
            }

            // Mark messages as deleted for this user based on whether they sent or received
            await pool.query(
                `UPDATE messages 
                 SET is_deleted_by_sender = CASE WHEN sender_id = $2 THEN true ELSE is_deleted_by_sender END,
                     is_deleted_by_receiver = CASE WHEN sender_id != $2 THEN true ELSE is_deleted_by_receiver END
                 WHERE conversation_id = $1`,
                [id, userId]
            );

            res.status(200).json({ success: true, message: "Conversation deleted successfully" });

        } catch (error) {
            console.error("Delete conversation error:", error);
            res.status(500).json({ success: false, error: "Failed to delete conversation" });
        }
    },

    // ==================== MESSAGES ====================

    // Get messages in a conversation
    getConversationMessages: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { conversation_id } = req.params;
            const { page = 1, limit = 50 } = req.query;

            const convCheck = await pool.query(
                "SELECT user1_id, user2_id FROM conversations WHERE id = $1",
                [conversation_id]
            );

            if (convCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Conversation not found" });
            }

            const conv = convCheck.rows[0];
            if (conv.user1_id !== userId && conv.user2_id !== userId) {
                return res.status(403).json({ success: false, error: "Access denied" });
            }

            const offset = (page - 1) * limit;

            const result = await pool.query(`
                SELECT 
                    m.*,
                    u.first_name || ' ' || u.last_name as sender_name,
                    u.profile_picture as sender_picture,
                    (
                        SELECT json_agg(json_build_object(
                            'id', mr.id,
                            'user_id', mr.user_id,
                            'reaction_type', mr.reaction_type,
                            'created_at', mr.created_at
                        ))
                        FROM message_reactions mr
                        WHERE mr.message_id = m.id
                    ) as reactions
                FROM messages m
                JOIN users u ON m.sender_id = u.id
                WHERE m.conversation_id = $1
                AND (
                    (m.sender_id = $2 AND m.is_deleted_by_sender = false) OR
                    (m.sender_id != $2 AND m.is_deleted_by_receiver = false)
                )
                ORDER BY m.created_at DESC
                LIMIT $3 OFFSET $4
            `, [conversation_id, userId, parseInt(limit), offset]);

            const countResult = await pool.query(`
                SELECT COUNT(*) as total FROM messages
                WHERE conversation_id = $1
                AND (
                    (sender_id = $2 AND is_deleted_by_sender = false) OR
                    (sender_id != $2 AND is_deleted_by_receiver = false)
                )
            `, [conversation_id, userId]);

            const total = parseInt(countResult.rows[0].total);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                total,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(total / limit)
                },
                data: result.rows.reverse() // oldest first
            });

        } catch (error) {
            console.error("Get messages error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch messages" });
        }
    },

    // Send message
    sendMessage: async (req, res) => {
        try {
            // ✅ FIX: was req.body.sender_id — client could impersonate any user
            const senderId = parseInt(req.user.id || req.user.userId);
            const {
                conversation_id,
                message_text,
                attachment_url,
                attachment_type,
                attachment_name,
                attachment_size
            } = req.body;

            if (!conversation_id || !message_text) {
                return res.status(400).json({
                    success: false,
                    error: "Conversation ID and message text are required"
                });
            }

            const convCheck = await pool.query(
                "SELECT user1_id, user2_id, is_blocked_by_user1, is_blocked_by_user2 FROM conversations WHERE id = $1",
                [conversation_id]
            );

            if (convCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Conversation not found" });
            }

            const conv = convCheck.rows[0];
            if (conv.user1_id !== senderId && conv.user2_id !== senderId) {
                return res.status(403).json({ success: false, error: "Access denied" });
            }

            // Check if blocked by the other user
            const isUser1 = conv.user1_id === senderId;
            const isBlocked = isUser1 ? conv.is_blocked_by_user2 : conv.is_blocked_by_user1;

            if (isBlocked) {
                return res.status(403).json({
                    success: false,
                    error: "Cannot send message. You have been blocked by this user."
                });
            }

            const result = await pool.query(
                `INSERT INTO messages (
                    conversation_id, sender_id, message_text,
                    attachment_url, attachment_type, attachment_name, attachment_size
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *`,
                [
                    conversation_id, senderId, message_text,
                    attachment_url || null, attachment_type || null,
                    attachment_name || null, attachment_size || null
                ]
            );

            const senderDetails = await pool.query(
                `SELECT first_name || ' ' || last_name as sender_name, profile_picture as sender_picture
                 FROM users WHERE id = $1`,
                [senderId]
            );

            res.status(201).json({
                success: true,
                message: "Message sent successfully",
                data: { ...result.rows[0], ...senderDetails.rows[0], reactions: [] }
            });

        } catch (error) {
            console.error("Send message error:", error);
            res.status(500).json({ success: false, error: "Failed to send message" });
        }
    },

    // Edit message
    editMessage: async (req, res) => {
        try {
            // ✅ FIX: was req.body.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;
            const { message_text } = req.body;

            if (!message_text) {
                return res.status(400).json({ success: false, error: "Message text is required" });
            }

            const messageCheck = await pool.query(
                "SELECT sender_id FROM messages WHERE id = $1",
                [id]
            );

            if (messageCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Message not found" });
            }

            if (messageCheck.rows[0].sender_id !== userId) {
                return res.status(403).json({ success: false, error: "You can only edit your own messages" });
            }

            const result = await pool.query(
                `UPDATE messages SET message_text = $1, is_edited = true WHERE id = $2 RETURNING *`,
                [message_text, id]
            );

            res.status(200).json({
                success: true,
                message: "Message edited successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Edit message error:", error);
            res.status(500).json({ success: false, error: "Failed to edit message" });
        }
    },

    // Delete message (soft delete; hard delete when both sides delete)
    deleteMessage: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { id } = req.params;

            const messageCheck = await pool.query(
                "SELECT sender_id FROM messages WHERE id = $1",
                [id]
            );

            if (messageCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Message not found" });
            }

            const isSender = messageCheck.rows[0].sender_id === userId;

            if (isSender) {
                await pool.query("UPDATE messages SET is_deleted_by_sender = true WHERE id = $1", [id]);
            } else {
                await pool.query("UPDATE messages SET is_deleted_by_receiver = true WHERE id = $1", [id]);
            }

            // Hard delete if both sides have deleted
            const deletedCheck = await pool.query(
                "SELECT is_deleted_by_sender, is_deleted_by_receiver FROM messages WHERE id = $1",
                [id]
            );

            if (
                deletedCheck.rows.length > 0 &&
                deletedCheck.rows[0].is_deleted_by_sender &&
                deletedCheck.rows[0].is_deleted_by_receiver
            ) {
                await pool.query("DELETE FROM messages WHERE id = $1", [id]);
            }

            res.status(200).json({ success: true, message: "Message deleted successfully" });

        } catch (error) {
            console.error("Delete message error:", error);
            res.status(500).json({ success: false, error: "Failed to delete message" });
        }
    },

    // Mark messages as read
    markMessagesAsRead: async (req, res) => {
        try {
            // ✅ FIX: was req.body.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { conversation_id } = req.params;

            await pool.query(
                `UPDATE messages 
                 SET is_read = true, read_at = CURRENT_TIMESTAMP
                 WHERE conversation_id = $1 
                 AND sender_id != $2 
                 AND is_read = false`,
                [conversation_id, userId]
            );

            res.status(200).json({ success: true, message: "Messages marked as read" });

        } catch (error) {
            console.error("Mark as read error:", error);
            res.status(500).json({ success: false, error: "Failed to mark messages as read" });
        }
    },

    // ==================== MESSAGE REACTIONS ====================

    addReaction: async (req, res) => {
        try {
            // ✅ FIX: was req.body.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { message_id } = req.params;
            const { reaction_type } = req.body;

            if (!reaction_type) {
                return res.status(400).json({ success: false, error: "Reaction type is required" });
            }

            const validReactions = ['like', 'love', 'haha', 'wow', 'sad', 'angry'];
            if (!validReactions.includes(reaction_type)) {
                return res.status(400).json({ success: false, error: "Invalid reaction type" });
            }

            const messageCheck = await pool.query("SELECT id FROM messages WHERE id = $1", [message_id]);
            if (messageCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Message not found" });
            }

            const result = await pool.query(
                `INSERT INTO message_reactions (message_id, user_id, reaction_type)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (message_id, user_id) DO UPDATE SET reaction_type = $3
                 RETURNING *`,
                [message_id, userId, reaction_type]
            );

            res.status(201).json({
                success: true,
                message: "Reaction added successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Add reaction error:", error);
            res.status(500).json({ success: false, error: "Failed to add reaction" });
        }
    },

    removeReaction: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { message_id } = req.params;

            const result = await pool.query(
                "DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 RETURNING *",
                [message_id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Reaction not found" });
            }

            res.status(200).json({ success: true, message: "Reaction removed successfully" });

        } catch (error) {
            console.error("Remove reaction error:", error);
            res.status(500).json({ success: false, error: "Failed to remove reaction" });
        }
    },

    // ==================== TYPING INDICATORS ====================

    setTypingIndicator: async (req, res) => {
        try {
            // ✅ FIX: was req.body.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { conversation_id } = req.body;

            if (!conversation_id) {
                return res.status(400).json({ success: false, error: "Conversation ID is required" });
            }

            await pool.query(
                `INSERT INTO typing_indicators (conversation_id, user_id, expires_at)
                 VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '10 seconds')
                 ON CONFLICT (conversation_id, user_id)
                 DO UPDATE SET started_at = CURRENT_TIMESTAMP,
                               expires_at = CURRENT_TIMESTAMP + INTERVAL '10 seconds'`,
                [conversation_id, userId]
            );

            res.status(200).json({ success: true, message: "Typing indicator set" });

        } catch (error) {
            console.error("Set typing indicator error:", error);
            res.status(500).json({ success: false, error: "Failed to set typing indicator" });
        }
    },

    getTypingStatus: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = parseInt(req.user.id || req.user.userId);
            const { conversation_id } = req.params;

            const result = await pool.query(
                `SELECT ti.*, u.first_name || ' ' || u.last_name as user_name
                 FROM typing_indicators ti
                 JOIN users u ON ti.user_id = u.id
                 WHERE ti.conversation_id = $1 
                 AND ti.user_id != $2 
                 AND ti.expires_at > CURRENT_TIMESTAMP`,
                [conversation_id, userId]
            );

            res.status(200).json({
                success: true,
                is_typing: result.rows.length > 0,
                data: result.rows.length > 0 ? result.rows[0] : null
            });

        } catch (error) {
            console.error("Get typing status error:", error);
            res.status(500).json({ success: false, error: "Failed to get typing status" });
        }
    },

    // ==================== STATISTICS ====================

    getMessagingStats: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id — now always scoped to current user
            const userId = parseInt(req.user.id || req.user.userId);

            const stats = await pool.query(`
                SELECT 
                    COUNT(DISTINCT c.id) as total_conversations,
                    COUNT(DISTINCT CASE WHEN m.sender_id = $1 THEN m.id END) as messages_sent,
                    COUNT(DISTINCT CASE WHEN m.sender_id != $1 THEN m.id END) as messages_received,
                    COUNT(DISTINCT CASE WHEN m.sender_id != $1 AND m.is_read = false THEN m.id END) as unread_messages
                FROM conversations c
                LEFT JOIN messages m ON c.id = m.conversation_id
                WHERE (c.user1_id = $1 OR c.user2_id = $1)
            `, [userId]);

            res.status(200).json({ success: true, data: stats.rows[0] });

        } catch (error) {
            console.error("Get stats error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch statistics" });
        }
    },

    getUnreadMessageCount: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);

            const result = await pool.query(
                `SELECT COUNT(DISTINCT m.conversation_id) as unread_conversations
                 FROM messages m
                 JOIN conversations c ON m.conversation_id = c.id
                 WHERE (c.user1_id = $1 OR c.user2_id = $1)
                 AND m.sender_id != $1
                 AND m.is_read = false`,
                [userId]
            );

            res.status(200).json({
                success: true,
                data: { unread_count: parseInt(result.rows[0].unread_conversations) }
            });

        } catch (error) {
            console.error("Get unread message count error:", error);
            res.status(500).json({ success: false, error: "Failed to get unread message count" });
        }
    }
};


// ==================== PRIVATE HELPER ====================

// Shared logic for archive/unarchive/block/unblock — updates the correct
// per-user flag column based on whether the current user is user1 or user2
async function _updateConversationFlag(conversationId, userId, flagType, value, res) {
    const convCheck = await pool.query(
        "SELECT user1_id, user2_id FROM conversations WHERE id = $1",
        [conversationId]
    );

    if (convCheck.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Conversation not found" });
    }

    const conv = convCheck.rows[0];
    const isUser1 = conv.user1_id === userId;
    const isUser2 = conv.user2_id === userId;

    if (!isUser1 && !isUser2) {
        return res.status(403).json({ success: false, error: "Access denied" });
    }

    const column = isUser1
        ? `${flagType}_by_user1`
        : `${flagType}_by_user2`;

    await pool.query(
        `UPDATE conversations SET ${column} = $1 WHERE id = $2`,
        [value, conversationId]
    );

    const action = value
        ? flagType === 'is_archived' ? 'archived' : 'blocked'
        : flagType === 'is_archived' ? 'unarchived' : 'unblocked';

    res.status(200).json({ success: true, message: `Conversation ${action} successfully` });
}

export default messageController;