// src/controllers/connectionController.js
import pool from "../config/db.js";
import notificationService from "../services/notificationService.js";

// ==================== ONE-TIME VIEW FIX ====================
// Run this SQL once in Cloud SQL Studio to add graduation_year and
// program_of_study to the v_user_connections view:
//
// CREATE OR REPLACE VIEW v_user_connections AS
// SELECT
//     c.id as connection_id,
//     c.user1_id,
//     c.user2_id,
//     c.connected_at,
//     u1.id as user1_full_id,
//     u1.first_name || ' ' || u1.last_name as user1_name,
//     u1.email as user1_email,
//     u1.profile_picture as user1_picture,
//     u1.current_company as user1_company,
//     u1.job_title as user1_title,
//     u1.graduation_year as user1_graduation_year,
//     u1.program_of_study as user1_program,
//     u2.id as user2_full_id,
//     u2.first_name || ' ' || u2.last_name as user2_name,
//     u2.email as user2_email,
//     u2.profile_picture as user2_picture,
//     u2.current_company as user2_company,
//     u2.job_title as user2_title,
//     u2.graduation_year as user2_graduation_year,
//     u2.program_of_study as user2_program
// FROM connections c
// JOIN users u1 ON c.user1_id = u1.id
// JOIN users u2 ON c.user2_id = u2.id
// WHERE u1.is_active = TRUE AND u2.is_active = TRUE;

const connectionController = {

    // ==================== SEND CONNECTION REQUEST ====================
    sendConnectionRequest: async (req, res) => {
        try {
            // ✅ Always use req.user — set by verifyToken middleware
            const senderId = parseInt(req.user.id || req.user.userId);

            if (isNaN(senderId)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid user ID"
                });
            }

            const { receiver_id, message } = req.body;

            if (!receiver_id) {
                return res.status(400).json({
                    success: false,
                    error: "Receiver ID is required"
                });
            }

            const receiverIdParsed = parseInt(receiver_id);

            if (isNaN(receiverIdParsed)) {
                return res.status(400).json({
                    success: false,
                    error: "Invalid receiver ID"
                });
            }

            if (senderId === receiverIdParsed) {
                return res.status(400).json({
                    success: false,
                    error: "Cannot send connection request to yourself"
                });
            }

            // Check if receiver exists
            const receiverCheck = await pool.query(
                "SELECT id FROM users WHERE id = $1 AND is_active = true",
                [receiverIdParsed]
            );

            if (receiverCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "User not found"
                });
            }

            // Check if connection already exists
            const connectionCheck = await pool.query(
                `SELECT id FROM connections 
                 WHERE user1_id = LEAST($1::integer, $2::integer) AND user2_id = GREATEST($1::integer, $2::integer)`,
                [senderId, receiverIdParsed]
            );

            if (connectionCheck.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: "Already connected with this user"
                });
            }

            // Check if pending request already exists
            const pendingCheck = await pool.query(
                `SELECT id, status FROM connection_requests 
                 WHERE ((sender_id = $1 AND receiver_id = $2) 
                    OR (sender_id = $2 AND receiver_id = $1))
                 AND status = 'pending'`,
                [senderId, receiverIdParsed]
            );

            if (pendingCheck.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: "Connection request already pending"
                });
            }

            // Create connection request
            const result = await pool.query(
                `INSERT INTO connection_requests (sender_id, receiver_id, message)
                 VALUES ($1, $2, $3)
                 RETURNING *`,
                [senderId, receiverIdParsed, message || null]
            );

            // Send notification (non-fatal)
            try {
                await notificationService.notifyConnectionRequest(senderId, receiverIdParsed);
            } catch (notifError) {
                console.warn('Notification failed (non-fatal):', notifError.message);
            }

            res.status(201).json({
                success: true,
                message: "Connection request sent successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Send connection request error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to send connection request"
            });
        }
    },

    // ==================== GET PENDING REQUESTS (RECEIVED) ====================
    getPendingRequests: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);

            const result = await pool.query(
                `SELECT * FROM v_connection_requests
                 WHERE receiver_id = $1 AND status = 'pending'
                 ORDER BY requested_at DESC`,
                [userId]
            );

            res.status(200).json({
                success: true,
                count: result.rows.length,
                data: result.rows
            });

        } catch (error) {
            console.error("Get pending requests error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to fetch pending requests"
            });
        }
    },

    // ==================== GET SENT REQUESTS ====================
    getSentRequests: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);

            const result = await pool.query(
                `SELECT * FROM v_connection_requests
                 WHERE sender_id = $1 AND status = 'pending'
                 ORDER BY requested_at DESC`,
                [userId]
            );

            res.status(200).json({
                success: true,
                count: result.rows.length,
                data: result.rows
            });

        } catch (error) {
            console.error("Get sent requests error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to fetch sent requests"
            });
        }
    },

    // ==================== ACCEPT CONNECTION REQUEST ====================
    acceptConnectionRequest: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { request_id } = req.params;

            const requestCheck = await pool.query(
                `SELECT * FROM connection_requests 
                 WHERE id = $1 AND receiver_id = $2 AND status = 'pending'`,
                [parseInt(request_id), userId]
            );

            if (requestCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Connection request not found or already responded"
                });
            }

            // Update status — DB trigger auto-creates the connection row
            const result = await pool.query(
                `UPDATE connection_requests 
                 SET status = 'accepted'
                 WHERE id = $1
                 RETURNING sender_id`,
                [parseInt(request_id)]
            );

            const senderId = result.rows[0].sender_id;

            // Notify the original requester (non-fatal)
            try {
                await notificationService.notifyConnectionAccepted(senderId, userId);
            } catch (notifError) {
                console.warn('Notification failed (non-fatal):', notifError.message);
            }

            res.status(200).json({
                success: true,
                message: "Connection request accepted"
            });

        } catch (error) {
            console.error("Accept connection error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to accept connection request"
            });
        }
    },

    // ==================== DECLINE CONNECTION REQUEST ====================
    declineConnectionRequest: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { request_id } = req.params;

            const requestCheck = await pool.query(
                `SELECT id FROM connection_requests 
                 WHERE id = $1 AND receiver_id = $2 AND status = 'pending'`,
                [parseInt(request_id), userId]
            );

            if (requestCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Connection request not found or already responded"
                });
            }

            await pool.query(
                `UPDATE connection_requests SET status = 'declined' WHERE id = $1`,
                [parseInt(request_id)]
            );

            res.status(200).json({
                success: true,
                message: "Connection request declined"
            });

        } catch (error) {
            console.error("Decline connection error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to decline connection request"
            });
        }
    },

    // ==================== CANCEL CONNECTION REQUEST ====================
    cancelConnectionRequest: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { request_id } = req.params;

            const requestCheck = await pool.query(
                `SELECT id FROM connection_requests 
                 WHERE id = $1 AND sender_id = $2 AND status = 'pending'`,
                [parseInt(request_id), userId]
            );

            if (requestCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Connection request not found or already responded"
                });
            }

            await pool.query(
                `UPDATE connection_requests SET status = 'cancelled' WHERE id = $1`,
                [parseInt(request_id)]
            );

            res.status(200).json({
                success: true,
                message: "Connection request cancelled"
            });

        } catch (error) {
            console.error("Cancel connection error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to cancel connection request"
            });
        }
    },

    // ==================== GET MY CONNECTIONS ====================
    getMyConnections: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { page = 1, limit = 20, search } = req.query;
            const offset = (page - 1) * limit;

            let queryText = `
                SELECT * FROM v_user_connections
                WHERE (user1_id = $1 OR user2_id = $1)
            `;
            const queryParams = [userId];
            let paramCount = 1;

            if (search) {
                paramCount++;
                queryText += ` AND (
                    user1_name ILIKE $${paramCount} OR 
                    user2_name ILIKE $${paramCount} OR
                    user1_company ILIKE $${paramCount} OR
                    user2_company ILIKE $${paramCount}
                )`;
                queryParams.push(`%${search}%`);
            }

            // Total count
            const countResult = await pool.query(
                `SELECT COUNT(*) FROM v_user_connections WHERE user1_id = $1 OR user2_id = $1`,
                [userId]
            );
            const totalConnections = parseInt(countResult.rows[0].count);

            queryText += ` ORDER BY connected_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            queryParams.push(parseInt(limit), offset);

            const result = await pool.query(queryText, queryParams);

            // Format to show the "other" user from the current user's perspective
            const connections = result.rows.map(conn => {
                const isUser1 = conn.user1_id === userId;
                return {
                    connection_id: conn.connection_id,
                    connected_at: conn.connected_at,
                    user: {
                        id: isUser1 ? conn.user2_full_id : conn.user1_full_id,
                        name: isUser1 ? conn.user2_name : conn.user1_name,
                        email: isUser1 ? conn.user2_email : conn.user1_email,
                        profile_picture: isUser1 ? conn.user2_picture : conn.user1_picture,
                        company: isUser1 ? conn.user2_company : conn.user1_company,
                        title: isUser1 ? conn.user2_title : conn.user1_title,
                        // ✅ FIX: These columns now exist in the updated view
                        graduation_year: isUser1 ? conn.user2_graduation_year : conn.user1_graduation_year,
                        program_of_study: isUser1 ? conn.user2_program : conn.user1_program
                    }
                };
            });

            res.status(200).json({
                success: true,
                count: connections.length,
                total: totalConnections,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(totalConnections / limit)
                },
                data: connections
            });

        } catch (error) {
            console.error("Get connections error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to fetch connections"
            });
        }
    },

    // ==================== REMOVE CONNECTION ====================
    removeConnection: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { connection_id } = req.params;

            const connectionCheck = await pool.query(
                `SELECT id FROM connections 
                 WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
                [parseInt(connection_id), userId]
            );

            if (connectionCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Connection not found"
                });
            }

            await pool.query(
                "DELETE FROM connections WHERE id = $1",
                [parseInt(connection_id)]
            );

            res.status(200).json({
                success: true,
                message: "Connection removed successfully"
            });

        } catch (error) {
            console.error("Remove connection error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to remove connection"
            });
        }
    },

    // ==================== CHECK CONNECTION STATUS ====================
    checkConnectionStatus: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);
            const { user_id } = req.params;
            const targetId = parseInt(user_id);

            const connectionCheck = await pool.query(
                `SELECT id FROM connections 
                 WHERE user1_id = LEAST($1::integer, $2::integer) AND user2_id = GREATEST($1::integer, $2::integer)`,
                [userId, targetId]
            );

            if (connectionCheck.rows.length > 0) {
                return res.status(200).json({
                    success: true,
                    status: "connected",
                    connection_id: connectionCheck.rows[0].id
                });
            }

            const requestCheck = await pool.query(
                `SELECT id, sender_id, receiver_id FROM connection_requests 
                 WHERE ((sender_id = $1 AND receiver_id = $2) 
                    OR (sender_id = $2 AND receiver_id = $1))
                 AND status = 'pending'`,
                [userId, targetId]
            );

            if (requestCheck.rows.length > 0) {
                const request = requestCheck.rows[0];
                const isSender = request.sender_id === userId;

                return res.status(200).json({
                    success: true,
                    status: isSender ? "request_sent" : "request_received",
                    request_id: request.id
                });
            }

            res.status(200).json({
                success: true,
                status: "not_connected"
            });

        } catch (error) {
            console.error("Check connection status error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to check connection status"
            });
        }
    },

    // ==================== GET CONNECTION STATS ====================
    getConnectionStats: async (req, res) => {
        try {
            const userId = parseInt(req.user.id || req.user.userId);

            const stats = await pool.query(
                `SELECT 
                    (SELECT COUNT(*) FROM connections WHERE user1_id = $1 OR user2_id = $1) as total_connections,
                    (SELECT COUNT(*) FROM connection_requests WHERE receiver_id = $1 AND status = 'pending') as pending_requests,
                    (SELECT COUNT(*) FROM connection_requests WHERE sender_id = $1 AND status = 'pending') as sent_requests`,
                [userId]
            );

            res.status(200).json({
                success: true,
                data: stats.rows[0]
            });

        } catch (error) {
            console.error("Get connection stats error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to fetch connection stats"
            });
        }
    }
};

export default connectionController;