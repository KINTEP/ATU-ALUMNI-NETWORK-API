// src/controllers/eventController.js
import pool from "../config/db.js";

const computedStatusSQL = `
  CASE
    WHEN e.status = 'cancelled' THEN 'cancelled'
    WHEN NOW() > e.end_date   THEN 'completed'
    WHEN NOW() >= e.start_date AND NOW() <= e.end_date THEN 'ongoing'
    ELSE 'upcoming'
  END
`;

const eventController = {

    createEvent: async (req, res) => {
        try {
            // ✅ FIX: was req.body.created_by
            const created_by = req.user.id || req.user.userId;
            const {
                title, description, event_type, category,
                start_date, end_date, location, location_type, venue_name,
                meeting_link, event_image, capacity, registration_deadline,
                is_free, ticket_price, currency, organizer_name, organizer_email,
                organizer_phone, tags, requirements, agenda, speakers,
                is_featured, is_published
            } = req.body;

            if (!title || !description || !event_type || !start_date || !end_date || !location || !location_type) {
                return res.status(400).json({ success: false, error: "Title, description, event type, start date, end date, location, and location type are required" });
            }
            const validEventTypes = ['Networking', 'Workshop', 'Conference', 'Social', 'Fundraiser', 'Webinar', 'Career Fair', 'Reunion', 'Sports', 'Other'];
            if (!validEventTypes.includes(event_type)) return res.status(400).json({ success: false, error: `Event type must be one of: ${validEventTypes.join(', ')}` });
            const validLocationTypes = ['In-person', 'Virtual', 'Hybrid'];
            if (!validLocationTypes.includes(location_type)) return res.status(400).json({ success: false, error: `Location type must be one of: ${validLocationTypes.join(', ')}` });
            if (new Date(end_date) <= new Date(start_date)) return res.status(400).json({ success: false, error: "End date must be after start date" });

            const result = await pool.query(
                `INSERT INTO events (created_by,title,description,event_type,category,start_date,end_date,location,location_type,venue_name,meeting_link,event_image,capacity,registration_deadline,is_free,ticket_price,currency,organizer_name,organizer_email,organizer_phone,tags,requirements,agenda,speakers,is_featured,is_published)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING *`,
                [created_by,title,description,event_type,category||null,start_date,end_date,location,location_type,venue_name||null,meeting_link||null,event_image||null,capacity||null,registration_deadline||null,is_free!==undefined?is_free:true,ticket_price||null,currency||'GHS',organizer_name||null,organizer_email||null,organizer_phone||null,tags||null,requirements||null,agenda||null,speakers||null,is_featured||false,is_published!==undefined?is_published:true]
            );
            res.status(201).json({ success: true, message: "Event created successfully", data: result.rows[0] });
        } catch (error) {
            console.error("Create event error:", error);
            res.status(500).json({ success: false, error: "Failed to create event" });
        }
    },

    getAllEvents: async (req, res) => {
        try {
            const { event_type, category, location_type, is_free, is_featured, status, start_date_from, start_date_to, search, page=1, limit=20, sort_by='start_date', sort_order='ASC' } = req.query;
            let queryText = `SELECT e.*, (${computedStatusSQL}) AS computed_status, u.first_name || ' ' || u.last_name AS created_by_name, u.email AS created_by_email FROM events e LEFT JOIN users u ON e.created_by = u.id WHERE e.is_published = true`;
            const queryParams = [];
            let p = 0;
            if (event_type) { p++; queryText += ` AND e.event_type = $${p}`; queryParams.push(event_type); }
            if (category) { p++; queryText += ` AND e.category ILIKE $${p}`; queryParams.push(`%${category}%`); }
            if (location_type) { p++; queryText += ` AND e.location_type = $${p}`; queryParams.push(location_type); }
            if (is_free === 'true') queryText += ` AND e.is_free = true`;
            else if (is_free === 'false') queryText += ` AND e.is_free = false`;
            if (is_featured === 'true') queryText += ` AND e.is_featured = true`;
            if (status && status !== 'all') {
                if (status === 'upcoming') queryText += ` AND e.status != 'cancelled' AND NOW() < e.start_date`;
                else if (status === 'ongoing') queryText += ` AND e.status != 'cancelled' AND NOW() >= e.start_date AND NOW() <= e.end_date`;
                else if (status === 'completed') queryText += ` AND e.status != 'cancelled' AND NOW() > e.end_date`;
                else if (status === 'cancelled') queryText += ` AND e.status = 'cancelled'`;
            }
            if (start_date_from) { p++; queryText += ` AND e.start_date >= $${p}`; queryParams.push(start_date_from); }
            if (start_date_to) { p++; queryText += ` AND e.start_date <= $${p}`; queryParams.push(start_date_to); }
            if (search) { p++; queryText += ` AND (e.title ILIKE $${p} OR e.description ILIKE $${p} OR e.location ILIKE $${p})`; queryParams.push(`%${search}%`); }

            const countQuery = `SELECT COUNT(*) FROM events e WHERE e.is_published = true ${queryText.split('WHERE e.is_published = true')[1].split('ORDER BY')[0]}`;
            const countResult = await pool.query(countQuery, queryParams);
            const totalEvents = parseInt(countResult.rows[0].count);

            const validSortFields = ['start_date','end_date','created_at','title','rsvp_count','views_count'];
            const sortField = validSortFields.includes(sort_by) ? sort_by : 'start_date';
            const order = sort_order.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            const offset = (page - 1) * limit;
            queryText += ` ORDER BY e.${sortField} ${order} LIMIT $${p+1} OFFSET $${p+2}`;
            queryParams.push(parseInt(limit), offset);

            const result = await pool.query(queryText, queryParams);
            res.status(200).json({ success: true, count: result.rows.length, total: totalEvents, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(totalEvents/limit) }, data: result.rows });
        } catch (error) {
            console.error("Get events error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch events" });
        }
    },

    getUpcomingEvents: async (req, res) => {
        try {
            const { page=1, limit=20 } = req.query;
            const offset = (page-1)*limit;
            const countResult = await pool.query(`SELECT COUNT(*) FROM events WHERE is_published = true AND status != 'cancelled' AND start_date > NOW()`);
            const result = await pool.query(`SELECT e.*, (${computedStatusSQL}) AS computed_status, u.first_name || ' ' || u.last_name AS created_by_name FROM events e LEFT JOIN users u ON e.created_by = u.id WHERE e.is_published = true AND e.status != 'cancelled' AND e.start_date > NOW() ORDER BY e.start_date ASC LIMIT $1 OFFSET $2`, [parseInt(limit), offset]);
            const totalEvents = parseInt(countResult.rows[0].count);
            res.status(200).json({ success: true, count: result.rows.length, total: totalEvents, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(totalEvents/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch upcoming events" });
        }
    },

    getPastEvents: async (req, res) => {
        try {
            const { page=1, limit=20 } = req.query;
            const offset = (page-1)*limit;
            const countResult = await pool.query(`SELECT COUNT(*) FROM events WHERE is_published = true AND status != 'cancelled' AND end_date < NOW()`);
            const result = await pool.query(`SELECT e.*, (${computedStatusSQL}) AS computed_status, u.first_name || ' ' || u.last_name AS created_by_name FROM events e LEFT JOIN users u ON e.created_by = u.id WHERE e.is_published = true AND e.status != 'cancelled' AND e.end_date < NOW() ORDER BY e.start_date DESC LIMIT $1 OFFSET $2`, [parseInt(limit), offset]);
            const totalEvents = parseInt(countResult.rows[0].count);
            res.status(200).json({ success: true, count: result.rows.length, total: totalEvents, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(totalEvents/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch past events" });
        }
    },

    getEventById: async (req, res) => {
        try {
            const { id } = req.params;
            if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid event ID" });
            const result = await pool.query(`SELECT e.*, (${computedStatusSQL}) AS computed_status, u.first_name || ' ' || u.last_name AS created_by_name, u.email AS created_by_email, u.role AS created_by_role FROM events e LEFT JOIN users u ON e.created_by = u.id WHERE e.id = $1 AND e.is_published = true`, [id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Event not found" });
            res.status(200).json({ success: true, data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch event" });
        }
    },

    updateEvent: async (req, res) => {
        try {
            const { id } = req.params;
            if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid event ID" });
            const eventCheck = await pool.query("SELECT id FROM events WHERE id = $1", [id]);
            if (eventCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Event not found" });

            const allowedFields = ['title','description','event_type','category','start_date','end_date','location','location_type','venue_name','meeting_link','event_image','capacity','registration_deadline','is_free','ticket_price','currency','organizer_name','organizer_email','organizer_phone','tags','requirements','agenda','speakers','is_featured','is_published','status'];
            const updates = [], values = [];
            let p = 0;
            Object.keys(req.body).forEach(key => {
                if (allowedFields.includes(key) && req.body[key] !== undefined) {
                    p++; updates.push(`${key} = $${p}`);
                    const raw = req.body[key];
                    if (key === 'tags') values.push(Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.trim() ? raw.split(',').map(t=>t.trim()).filter(Boolean) : []));
                    else if (key === 'speakers') { if (!raw||raw==='') values.push(null); else if (typeof raw==='object') values.push(JSON.stringify(raw)); else { try { JSON.parse(raw); values.push(raw); } catch { values.push(null); } } }
                    else if (['start_date','end_date','registration_deadline'].includes(key)) { if (!raw||raw==='') values.push(null); else { const d=new Date(raw); values.push(isNaN(d.getTime())?null:d.toISOString()); } }
                    else values.push(raw);
                }
            });
            if (updates.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });
            values.push(id); p++;
            const result = await pool.query(`UPDATE events SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`, values);
            res.status(200).json({ success: true, message: "Event updated successfully", data: result.rows[0] });
        } catch (error) {
            console.error("Update event error:", error);
            res.status(500).json({ success: false, error: "Failed to update event" });
        }
    },

    deleteEvent: async (req, res) => {
        try {
            const result = await pool.query("UPDATE events SET is_published = false WHERE id = $1 RETURNING id", [req.params.id]);
            if (result.rowCount === 0) return res.status(404).json({ success: false, error: "Event not found" });
            res.status(200).json({ success: true, message: "Event deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete event" });
        }
    },

    incrementViewCount: async (req, res) => {
        try {
            await pool.query("UPDATE events SET views_count = views_count + 1 WHERE id = $1", [req.params.id]);
            res.status(200).json({ success: true, message: "View count updated" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update view count" });
        }
    },

    getEventStats: async (req, res) => {
        try {
            const [totalResult, typeResult, statusResult, upcomingResult, rsvpResult, attendanceResult, popularResult] = await Promise.all([
                pool.query("SELECT COUNT(*) AS total FROM events WHERE is_published = true"),
                pool.query(`SELECT event_type, COUNT(*) AS count FROM events WHERE is_published = true GROUP BY event_type ORDER BY count DESC`),
                pool.query(`SELECT computed_status AS status, COUNT(*) AS count FROM (SELECT CASE WHEN status='cancelled' THEN 'cancelled' WHEN NOW()>end_date THEN 'completed' WHEN NOW()>=start_date AND NOW()<=end_date THEN 'ongoing' ELSE 'upcoming' END AS computed_status FROM events WHERE is_published=true) sub GROUP BY computed_status ORDER BY count DESC`),
                pool.query(`SELECT COUNT(*) AS count FROM events WHERE is_published=true AND status!='cancelled' AND start_date>NOW()`),
                pool.query("SELECT COUNT(*) AS total FROM event_rsvps WHERE status='going'"),
                pool.query(`SELECT AVG(CASE WHEN capacity>0 THEN (rsvp_count::float/capacity)*100 ELSE 0 END) AS avg_rate FROM events WHERE is_published=true AND capacity IS NOT NULL`),
                pool.query(`SELECT id, title, event_type, start_date, rsvp_count, views_count FROM events WHERE is_published=true ORDER BY rsvp_count DESC LIMIT 10`)
            ]);
            res.status(200).json({ success: true, data: { total_events: parseInt(totalResult.rows[0].total), total_rsvps: parseInt(rsvpResult.rows[0].total), upcoming_events: parseInt(upcomingResult.rows[0].count), avg_attendance_rate: parseFloat(attendanceResult.rows[0].avg_rate||0).toFixed(2), by_event_type: typeResult.rows, by_status: statusResult.rows, most_popular_events: popularResult.rows } });
        } catch (error) {
            console.error("Get event stats error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch event statistics" });
        }
    },

    rsvpToEvent: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { status, guests_count, notes } = req.body;
            if (!status) return res.status(400).json({ success: false, error: "Status is required" });
            const validStatuses = ['going','maybe','not_going'];
            if (!validStatuses.includes(status)) return res.status(400).json({ success: false, error: `Status must be one of: ${validStatuses.join(', ')}` });

            const eventCheck = await pool.query("SELECT id, capacity, rsvp_count, registration_deadline FROM events WHERE id = $1 AND is_published = true", [id]);
            if (eventCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Event not found" });
            const event = eventCheck.rows[0];
            if (event.registration_deadline && new Date(event.registration_deadline) < new Date()) return res.status(400).json({ success: false, error: "Registration deadline has passed" });
            if (status === 'going' && event.capacity && event.rsvp_count >= event.capacity) return res.status(400).json({ success: false, error: "Event is at full capacity" });

            const existingRsvp = await pool.query("SELECT id FROM event_rsvps WHERE event_id = $1 AND user_id = $2", [id, userId]);
            if (existingRsvp.rows.length > 0) {
                const result = await pool.query(`UPDATE event_rsvps SET status=$1,guests_count=$2,notes=$3 WHERE event_id=$4 AND user_id=$5 RETURNING *`, [status, guests_count||0, notes||null, id, userId]);
                return res.status(200).json({ success: true, message: "RSVP updated successfully", data: result.rows[0] });
            }
            const result = await pool.query(`INSERT INTO event_rsvps (event_id,user_id,status,guests_count,notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [id, userId, status, guests_count||0, notes||null]);
            res.status(201).json({ success: true, message: "RSVP submitted successfully", data: result.rows[0] });
        } catch (error) {
            console.error("RSVP error:", error);
            res.status(500).json({ success: false, error: "Failed to submit RSVP" });
        }
    },

    updateRsvp: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { status, guests_count, notes } = req.body;
            const result = await pool.query(`UPDATE event_rsvps SET status=COALESCE($1,status),guests_count=COALESCE($2,guests_count),notes=COALESCE($3,notes) WHERE event_id=$4 AND user_id=$5 RETURNING *`, [status, guests_count, notes, id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "RSVP not found" });
            res.status(200).json({ success: true, message: "RSVP updated successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to update RSVP" });
        }
    },

    cancelRsvp: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const result = await pool.query("DELETE FROM event_rsvps WHERE event_id=$1 AND user_id=$2 RETURNING *", [id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "RSVP not found" });
            res.status(200).json({ success: true, message: "RSVP cancelled successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to cancel RSVP" });
        }
    },

    getMyEvents: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id
            const userId = req.user.id || req.user.userId;
            const { status, page=1, limit=20 } = req.query;
            let queryText = `SELECT er.*, e.title, e.description, e.event_type, e.start_date, e.end_date, e.location, e.location_type, e.event_image, e.is_free, (${computedStatusSQL}) AS event_status FROM event_rsvps er JOIN events e ON er.event_id = e.id WHERE er.user_id=$1 AND e.is_published=true`;
            const queryParams = [userId];
            let p = 1;
            if (status) { p++; queryText += ` AND er.status=$${p}`; queryParams.push(status); }
            const countResult = await pool.query(queryText.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM'), queryParams);
            const total = parseInt(countResult.rows[0].count);
            const offset = (page-1)*limit;
            queryText += ` ORDER BY e.start_date ASC LIMIT $${p+1} OFFSET $${p+2}`;
            queryParams.push(parseInt(limit), offset);
            const result = await pool.query(queryText, queryParams);
            res.status(200).json({ success: true, count: result.rows.length, total, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch events" });
        }
    },

    getEventAttendees: async (req, res) => {
        try {
            const { id } = req.params;
            const { status, checked_in, page=1, limit=50 } = req.query;
            let queryText = `SELECT er.*, u.first_name, u.last_name, u.email, u.phone_number, u.graduation_year, u.program_of_study, u.profile_picture FROM event_rsvps er JOIN users u ON er.user_id=u.id WHERE er.event_id=$1`;
            const queryParams = [id];
            let p = 1;
            if (status) { p++; queryText += ` AND er.status=$${p}`; queryParams.push(status); }
            if (checked_in === 'true') queryText += ` AND er.checked_in=true`;
            else if (checked_in === 'false') queryText += ` AND er.checked_in=false`;
            const countResult = await pool.query(queryText.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM'), queryParams);
            const total = parseInt(countResult.rows[0].count);
            const offset = (page-1)*limit;
            queryText += ` ORDER BY er.rsvp_at DESC LIMIT $${p+1} OFFSET $${p+2}`;
            queryParams.push(parseInt(limit), offset);
            const result = await pool.query(queryText, queryParams);
            res.status(200).json({ success: true, count: result.rows.length, total, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total/limit) }, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch attendees" });
        }
    },

    checkInAttendee: async (req, res) => {
        try {
            const { id, userId } = req.params;
            const result = await pool.query(`UPDATE event_rsvps SET checked_in=true,checked_in_at=CURRENT_TIMESTAMP WHERE event_id=$1 AND user_id=$2 RETURNING *`, [id, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "RSVP not found" });
            res.status(200).json({ success: true, message: "Attendee checked in", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to check in attendee" });
        }
    },

    publishEvent: async (req, res) => {
        try {
            const result = await pool.query("UPDATE events SET is_published=true WHERE id=$1 RETURNING *", [req.params.id]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Event not found" });
            res.status(200).json({ success: true, message: "Event published successfully", data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to publish event" });
        }
    },

    getEventComments: async (req, res) => {
        try {
            const { id } = req.params;
            const { page=1, limit=50 } = req.query;
            // ✅ FIX: get userId from token, not query param
            const userId = req.user?.id || req.user?.userId || 0;
            const offset = (page-1)*limit;
            const result = await pool.query(`SELECT ec.*, u.first_name, u.last_name, u.profile_picture, (SELECT COUNT(*) FROM event_comments WHERE parent_comment_id=ec.id AND is_deleted=false) AS reply_count, (SELECT COUNT(*)>0 FROM event_comment_likes WHERE comment_id=ec.id AND user_id=$3) AS user_has_liked FROM event_comments ec JOIN users u ON ec.user_id=u.id WHERE ec.event_id=$1 AND ec.parent_comment_id IS NULL AND ec.is_deleted=false ORDER BY ec.created_at DESC LIMIT $2 OFFSET $4`, [id, parseInt(limit), userId, offset]);
            const countResult = await pool.query(`SELECT COUNT(*) FROM event_comments WHERE event_id=$1 AND parent_comment_id IS NULL AND is_deleted=false`, [id]);
            const total = parseInt(countResult.rows[0].count);
            res.status(200).json({ success: true, count: result.rows.length, total, pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total/limit) }, data: result.rows });
        } catch (error) {
            console.error("Get comments error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch comments" });
        }
    },

    getCommentReplies: async (req, res) => {
        try {
            const { id, commentId } = req.params;
            const userId = req.user?.id || req.user?.userId || 0;
            const result = await pool.query(`SELECT ec.*, u.first_name, u.last_name, u.profile_picture, (SELECT COUNT(*)>0 FROM event_comment_likes WHERE comment_id=ec.id AND user_id=$3) AS user_has_liked FROM event_comments ec JOIN users u ON ec.user_id=u.id WHERE ec.parent_comment_id=$1 AND ec.event_id=$2 AND ec.is_deleted=false ORDER BY ec.created_at ASC`, [commentId, id, userId]);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch replies" });
        }
    },

    addComment: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { comment } = req.body;
            if (!comment) return res.status(400).json({ success: false, error: "Comment is required" });
            if (comment.length < 1 || comment.length > 2000) return res.status(400).json({ success: false, error: "Comment must be 1-2000 characters" });
            const eventCheck = await pool.query("SELECT id FROM events WHERE id=$1 AND is_published=true", [id]);
            if (eventCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Event not found" });
            const result = await pool.query(`INSERT INTO event_comments (event_id,user_id,comment) VALUES ($1,$2,$3) RETURNING *`, [id, userId, comment]);
            const userInfo = await pool.query("SELECT first_name, last_name, profile_picture FROM users WHERE id=$1", [userId]);
            res.status(201).json({ success: true, message: "Comment added successfully", data: { ...result.rows[0], ...userInfo.rows[0], reply_count: 0, user_has_liked: false } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to add comment" });
        }
    },

    replyToComment: async (req, res) => {
        try {
            const { id, commentId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { comment } = req.body;
            if (!comment || comment.length < 1 || comment.length > 2000) return res.status(400).json({ success: false, error: "Comment must be 1-2000 characters" });
            const commentCheck = await pool.query("SELECT id FROM event_comments WHERE id=$1 AND event_id=$2", [commentId, id]);
            if (commentCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Parent comment not found" });
            const result = await pool.query(`INSERT INTO event_comments (event_id,user_id,parent_comment_id,comment) VALUES ($1,$2,$3,$4) RETURNING *`, [id, userId, commentId, comment]);
            const userInfo = await pool.query("SELECT first_name, last_name, profile_picture FROM users WHERE id=$1", [userId]);
            res.status(201).json({ success: true, message: "Reply added successfully", data: { ...result.rows[0], ...userInfo.rows[0], user_has_liked: false } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to add reply" });
        }
    },

    updateComment: async (req, res) => {
        try {
            const { id, commentId } = req.params;
            // ✅ FIX: was req.body.user_id
            const userId = req.user.id || req.user.userId;
            const { comment } = req.body;
            if (!comment || comment.length < 1 || comment.length > 2000) return res.status(400).json({ success: false, error: "Comment must be 1-2000 characters" });
            const result = await pool.query(`UPDATE event_comments SET comment=$1 WHERE id=$2 AND event_id=$3 AND user_id=$4 RETURNING *`, [comment, commentId, id, userId]);
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
            const result = await pool.query(`UPDATE event_comments SET is_deleted=true,comment='[Comment deleted]' WHERE id=$1 AND event_id=$2 AND user_id=$3 RETURNING *`, [commentId, id, userId]);
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
            const existingLike = await pool.query("SELECT id FROM event_comment_likes WHERE comment_id=$1 AND user_id=$2", [commentId, userId]);
            if (existingLike.rows.length > 0) return res.status(409).json({ success: false, error: "Comment already liked" });
            await pool.query("INSERT INTO event_comment_likes (comment_id,user_id) VALUES ($1,$2)", [commentId, userId]);
            const commentResult = await pool.query("SELECT likes_count FROM event_comments WHERE id=$1", [commentId]);
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
            const result = await pool.query("DELETE FROM event_comment_likes WHERE comment_id=$1 AND user_id=$2 RETURNING *", [commentId, userId]);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Like not found" });
            const commentResult = await pool.query("SELECT likes_count FROM event_comments WHERE id=$1", [commentId]);
            res.status(200).json({ success: true, message: "Comment unliked successfully", data: { likes_count: commentResult.rows[0].likes_count } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to unlike comment" });
        }
    }
};

export default eventController;