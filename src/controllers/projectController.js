// src/controllers/projectController.js
import pool from "../config/db.js";

const projectController = {

  getAllProjects: async (req, res) => {
    try {
      const { status, category, search, featured, page = 1, limit = 10, sort = "created_at" } = req.query;
      const conditions = [];
      const params = [];

      if (status) {
        params.push(status);
        conditions.push(`p.status = $${params.length}`);
      } else {
        conditions.push(`p.status != 'draft'`);
      }
      if (category) {
        params.push(category);
        conditions.push(`p.category = $${params.length}`);
      }
      if (featured === "true") conditions.push(`p.is_featured = true`);
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length} OR p.location ILIKE $${params.length})`);
      }

      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const offset = (parseInt(page) - 1) * parseInt(limit);
      params.push(parseInt(limit), offset);

      const query = `
        SELECT p.*,
          u.first_name, u.last_name, u.profile_picture,
          COUNT(DISTINCT pv.id) FILTER (WHERE pv.id IS NOT NULL) AS volunteers_count,
          COUNT(DISTINCT pvt.id) FILTER (WHERE pvt.id IS NOT NULL) AS votes_count,
          COUNT(DISTINCT pd.id) FILTER (WHERE pd.status = 'completed') AS donors_count
        FROM projects p
        LEFT JOIN users u ON p.created_by = u.id
        LEFT JOIN project_volunteers pv ON pv.project_id = p.id
        LEFT JOIN project_votes pvt ON pvt.project_id = p.id
        LEFT JOIN project_donations pd ON pd.project_id = p.id
        ${where}
        GROUP BY p.id, u.first_name, u.last_name, u.profile_picture
        ORDER BY p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `;

      const countQuery = `SELECT COUNT(*) FROM projects p ${where}`;
      const [result, countResult] = await Promise.all([
        pool.query(query, params),
        pool.query(countQuery, params.slice(0, -2))
      ]);

      const total = parseInt(countResult.rows[0].count);
      res.json({
        success: true,
        data: result.rows.map(formatProject),
        pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
      });
    } catch (error) {
      console.error("Error fetching projects:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getProjectStats: async (req, res) => {
    try {
      const stats = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'ongoing') AS ongoing,
          COUNT(*) FILTER (WHERE status = 'proposed') AS proposed,
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COALESCE(SUM(current_amount), 0) AS total_raised,
          COALESCE(SUM(funding_goal), 0) AS total_funding_goal
        FROM projects WHERE status != 'draft'
      `);
      const donorStats = await pool.query(`
        SELECT COUNT(DISTINCT user_id) AS total_donors, COALESCE(SUM(amount), 0) AS total_donations
        FROM project_donations WHERE status = 'completed'
      `);
      const volunteerStats = await pool.query(`
        SELECT COUNT(DISTINCT user_id) AS total_volunteers FROM project_volunteers
      `);
      res.json({
        success: true,
        data: {
          ...stats.rows[0],
          total_donors: parseInt(donorStats.rows[0].total_donors),
          total_donations: parseFloat(donorStats.rows[0].total_donations),
          total_volunteers: parseInt(volunteerStats.rows[0].total_volunteers)
        }
      });
    } catch (error) {
      console.error("Error fetching project stats:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getProjectById: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(`
        SELECT p.*, u.first_name, u.last_name, u.profile_picture
        FROM projects p
        LEFT JOIN users u ON p.created_by = u.id
        WHERE p.id = $1
      `, [id]);

      if (!result.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      const project = result.rows[0];
      if (project.status === "draft" && (!req.user || req.user.role !== "admin"))
        return res.status(404).json({ success: false, message: "Project not found" });

      const [donations, volunteers, votes, updates] = await Promise.all([
        pool.query(`SELECT pd.*, u.first_name, u.last_name, u.profile_picture FROM project_donations pd LEFT JOIN users u ON pd.user_id = u.id WHERE pd.project_id = $1 AND pd.status = 'completed' ORDER BY pd.created_at DESC`, [id]),
        pool.query(`SELECT pv.*, u.first_name, u.last_name, u.profile_picture FROM project_volunteers pv LEFT JOIN users u ON pv.user_id = u.id WHERE pv.project_id = $1`, [id]),
        pool.query(`SELECT COUNT(*) FROM project_votes WHERE project_id = $1`, [id]),
        pool.query(`SELECT pu.*, u.first_name, u.last_name FROM project_updates pu LEFT JOIN users u ON pu.posted_by = u.id WHERE pu.project_id = $1 ORDER BY pu.created_at DESC`, [id]),
      ]);

      res.json({
        success: true,
        data: {
          ...formatProject(project),
          donations: donations.rows,
          volunteers: volunteers.rows,
          votes_count: parseInt(votes.rows[0].count),
          updates: updates.rows
        }
      });
    } catch (error) {
      console.error("Error fetching project:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getProjectDonors: async (req, res) => {
    try {
      const { page = 1, limit = 10 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);
      const [result, count] = await Promise.all([
        pool.query(`
          SELECT pd.id, pd.amount, pd.anonymous, pd.created_at,
            CASE WHEN pd.anonymous THEN NULL ELSE u.first_name END as first_name,
            CASE WHEN pd.anonymous THEN NULL ELSE u.last_name END as last_name,
            CASE WHEN pd.anonymous THEN NULL ELSE u.profile_picture END as profile_picture
          FROM project_donations pd
          LEFT JOIN users u ON pd.user_id = u.id
          WHERE pd.project_id = $1 AND pd.status = 'completed'
          ORDER BY pd.created_at DESC LIMIT $2 OFFSET $3
        `, [req.params.id, parseInt(limit), offset]),
        pool.query(`SELECT COUNT(*) FROM project_donations WHERE project_id = $1 AND status = 'completed'`, [req.params.id])
      ]);
      const total = parseInt(count.rows[0].count);
      res.json({ success: true, data: result.rows, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } });
    } catch (error) {
      console.error("Error fetching donors:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getTopDonors: async (req, res) => {
    try {
      const { limit = 10 } = req.query;
      const result = await pool.query(`
        SELECT pd.user_id, SUM(pd.amount) AS total_donated, COUNT(*) AS donation_count,
          u.first_name, u.last_name, u.profile_picture
        FROM project_donations pd
        JOIN users u ON pd.user_id = u.id
        WHERE pd.status = 'completed' AND pd.anonymous = false
        GROUP BY pd.user_id, u.first_name, u.last_name, u.profile_picture
        ORDER BY total_donated DESC LIMIT $1
      `, [parseInt(limit)]);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Error fetching top donors:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getRecentActivity: async (req, res) => {
    try {
      const { limit = 10 } = req.query;
      const [donations, volunteers] = await Promise.all([
        pool.query(`
          SELECT 'donation' AS type, p.title AS project_title, p.id AS project_id,
            pd.amount, pd.anonymous, pd.created_at,
            u.first_name, u.last_name, u.profile_picture
          FROM project_donations pd
          JOIN projects p ON pd.project_id = p.id
          JOIN users u ON pd.user_id = u.id
          WHERE pd.status = 'completed'
          ORDER BY pd.created_at DESC LIMIT $1
        `, [parseInt(limit)]),
        pool.query(`
          SELECT 'volunteer' AS type, p.title AS project_title, p.id AS project_id,
            pv.joined_at AS created_at,
            u.first_name, u.last_name, u.profile_picture
          FROM project_volunteers pv
          JOIN projects p ON pv.project_id = p.id
          JOIN users u ON pv.user_id = u.id
          ORDER BY pv.joined_at DESC LIMIT $1
        `, [parseInt(limit)])
      ]);
      const activity = [...donations.rows, ...volunteers.rows]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, parseInt(limit));
      res.json({ success: true, data: activity });
    } catch (error) {
      console.error("Error fetching recent activity:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  donate: async (req, res) => {
    try {
      const { amount, reference, payment_method, anonymous } = req.body;
      if (!amount || amount <= 0) return res.status(400).json({ success: false, message: "Valid amount required" });
      const project = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      if (!project.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      const p = project.rows[0];
      if (!p.accept_donations) return res.status(400).json({ success: false, message: "Not accepting donations" });
      if (p.status !== "ongoing") return res.status(400).json({ success: false, message: "Donations only for ongoing projects" });

      await pool.query(`INSERT INTO project_donations (project_id, user_id, amount, reference, payment_method, anonymous, status) VALUES ($1,$2,$3,$4,$5,$6,'completed')`,
        [req.params.id, req.user.id, amount, reference || null, payment_method || "paystack", anonymous || false]);
      const updated = await pool.query(`UPDATE projects SET current_amount = current_amount + $1, updated_at = NOW() WHERE id = $2 RETURNING current_amount, funding_goal`,
        [amount, req.params.id]);
      const { current_amount, funding_goal } = updated.rows[0];
      res.json({ success: true, message: "Donation recorded", data: { current_amount, funding_percentage: funding_goal > 0 ? Math.round((current_amount / funding_goal) * 100) : 0 } });
    } catch (error) {
      console.error("Error donating:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  volunteer: async (req, res) => {
    try {
      const project = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      if (!project.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      const p = project.rows[0];
      if (!p.accept_volunteers) return res.status(400).json({ success: false, message: "Not accepting volunteers" });
      if (p.status !== "ongoing") return res.status(400).json({ success: false, message: "Volunteering only for ongoing projects" });
      const existing = await pool.query(`SELECT id FROM project_volunteers WHERE project_id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
      if (existing.rows.length) return res.status(400).json({ success: false, message: "Already volunteered" });
      if (p.max_volunteers) {
        const count = await pool.query(`SELECT COUNT(*) FROM project_volunteers WHERE project_id = $1`, [req.params.id]);
        if (parseInt(count.rows[0].count) >= p.max_volunteers) return res.status(400).json({ success: false, message: "Spots full" });
      }
      await pool.query(`INSERT INTO project_volunteers (project_id, user_id) VALUES ($1, $2)`, [req.params.id, req.user.id]);
      const count = await pool.query(`SELECT COUNT(*) FROM project_volunteers WHERE project_id = $1`, [req.params.id]);
      res.json({ success: true, message: "Signed up as volunteer!", data: { volunteers_count: parseInt(count.rows[0].count) } });
    } catch (error) {
      console.error("Error volunteering:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  withdrawVolunteer: async (req, res) => {
    try {
      const result = await pool.query(`DELETE FROM project_volunteers WHERE project_id = $1 AND user_id = $2 RETURNING id`, [req.params.id, req.user.id]);
      if (!result.rows.length) return res.status(400).json({ success: false, message: "Not a volunteer" });
      const count = await pool.query(`SELECT COUNT(*) FROM project_volunteers WHERE project_id = $1`, [req.params.id]);
      res.json({ success: true, message: "Withdrawn", data: { volunteers_count: parseInt(count.rows[0].count) } });
    } catch (error) {
      console.error("Error withdrawing:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  vote: async (req, res) => {
    try {
      const project = await pool.query(`SELECT * FROM projects WHERE id = $1`, [req.params.id]);
      if (!project.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      if (project.rows[0].status !== "proposed") return res.status(400).json({ success: false, message: "Voting only for proposed projects" });
      const existing = await pool.query(`SELECT id FROM project_votes WHERE project_id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
      if (existing.rows.length) return res.status(400).json({ success: false, message: "Already voted" });
      await pool.query(`INSERT INTO project_votes (project_id, user_id) VALUES ($1, $2)`, [req.params.id, req.user.id]);
      const count = await pool.query(`SELECT COUNT(*) FROM project_votes WHERE project_id = $1`, [req.params.id]);
      res.json({ success: true, message: "Vote recorded!", data: { votes_count: parseInt(count.rows[0].count), votes_required: project.rows[0].votes_required } });
    } catch (error) {
      console.error("Error voting:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  retractVote: async (req, res) => {
    try {
      const result = await pool.query(`DELETE FROM project_votes WHERE project_id = $1 AND user_id = $2 RETURNING id`, [req.params.id, req.user.id]);
      if (!result.rows.length) return res.status(400).json({ success: false, message: "Not voted" });
      const [count, project] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM project_votes WHERE project_id = $1`, [req.params.id]),
        pool.query(`SELECT votes_required FROM projects WHERE id = $1`, [req.params.id])
      ]);
      res.json({ success: true, message: "Vote retracted", data: { votes_count: parseInt(count.rows[0].count), votes_required: project.rows[0].votes_required } });
    } catch (error) {
      console.error("Error retracting vote:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  createProject: async (req, res) => {
    try {
      const { title, description, long_description, category, status, location, cover_image, start_date, target_date, funding_goal, current_amount, accept_donations, accept_volunteers, max_volunteers, is_featured } = req.body;
      if (!title || !description || !category || !location || !start_date || !funding_goal)
        return res.status(400).json({ success: false, message: "Title, description, category, location, start date, and funding goal are required" });
      const result = await pool.query(`
        INSERT INTO projects (title, description, long_description, category, status, location, cover_image, start_date, target_date, funding_goal, current_amount, accept_donations, accept_volunteers, max_volunteers, is_featured, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *
      `, [title, description, long_description || null, category, status || "proposed", location, cover_image || null, start_date, target_date || null, funding_goal, current_amount || 0, accept_donations !== false, accept_volunteers !== false, max_volunteers || null, is_featured || false, req.user.id]);
      res.status(201).json({ success: true, message: "Project created successfully", data: formatProject(result.rows[0]) });
    } catch (error) {
      console.error("Error creating project:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  updateProject: async (req, res) => {
    try {
      const allowed = ["title","description","long_description","category","status","location","cover_image","start_date","target_date","funding_goal","current_amount","accept_donations","accept_volunteers","max_volunteers","is_featured","votes_required"];
      const updates = [];
      const params = [];
      allowed.forEach(f => {
        if (req.body[f] !== undefined) {
          params.push(req.body[f]);
          updates.push(`${f} = $${params.length}`);
        }
      });
      if (!updates.length) return res.status(400).json({ success: false, message: "No valid fields to update" });
      params.push(req.params.id);
      const result = await pool.query(`UPDATE projects SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`, params);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      res.json({ success: true, message: "Project updated", data: formatProject(result.rows[0]) });
    } catch (error) {
      console.error("Error updating project:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  deleteProject: async (req, res) => {
    try {
      const result = await pool.query(`DELETE FROM projects WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      res.json({ success: true, message: "Project deleted" });
    } catch (error) {
      console.error("Error deleting project:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  approveProject: async (req, res) => {
    try {
      const result = await pool.query(`UPDATE projects SET status = 'ongoing', updated_at = NOW() WHERE id = $1 AND status = 'proposed' RETURNING *`, [req.params.id]);
      if (!result.rows.length) return res.status(400).json({ success: false, message: "Project not found or not in proposed status" });
      res.json({ success: true, message: "Project approved", data: formatProject(result.rows[0]) });
    } catch (error) {
      console.error("Error approving:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  rejectProject: async (req, res) => {
    try {
      const { reason } = req.body;
      const result = await pool.query(`UPDATE projects SET status = 'draft', updated_at = NOW() WHERE id = $1 AND status = 'proposed' RETURNING *`, [req.params.id]);
      if (!result.rows.length) return res.status(400).json({ success: false, message: "Project not found or not in proposed status" });
      res.json({ success: true, message: reason ? `Rejected: ${reason}` : "Project rejected", data: formatProject(result.rows[0]) });
    } catch (error) {
      console.error("Error rejecting:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  completeProject: async (req, res) => {
    try {
      const result = await pool.query(`UPDATE projects SET status = 'completed', updated_at = NOW() WHERE id = $1 AND status = 'ongoing' RETURNING *`, [req.params.id]);
      if (!result.rows.length) return res.status(400).json({ success: false, message: "Project not found or not ongoing" });
      res.json({ success: true, message: "Project completed", data: formatProject(result.rows[0]) });
    } catch (error) {
      console.error("Error completing:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  addUpdate: async (req, res) => {
    try {
      const { title, content, type, image } = req.body;
      if (!title || !content) return res.status(400).json({ success: false, message: "Title and content required" });
      const project = await pool.query(`SELECT id FROM projects WHERE id = $1`, [req.params.id]);
      if (!project.rows.length) return res.status(404).json({ success: false, message: "Project not found" });
      const result = await pool.query(`INSERT INTO project_updates (project_id, title, content, type, image, posted_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [req.params.id, title, content, type || "update", image || null, req.user.id]);
      res.status(201).json({ success: true, message: "Update added", data: result.rows[0] });
    } catch (error) {
      console.error("Error adding update:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  deleteUpdate: async (req, res) => {
    try {
      const result = await pool.query(`DELETE FROM project_updates WHERE id = $1 AND project_id = $2 RETURNING id`, [req.params.updateId, req.params.id]);
      if (!result.rows.length) return res.status(404).json({ success: false, message: "Update not found" });
      res.json({ success: true, message: "Update deleted" });
    } catch (error) {
      console.error("Error deleting update:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getProjectVolunteers: async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT pv.*, u.first_name, u.last_name, u.email, u.profile_picture
        FROM project_volunteers pv
        JOIN users u ON pv.user_id = u.id
        WHERE pv.project_id = $1
      `, [req.params.id]);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Error fetching volunteers:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  adminGetAllProjects: async (req, res) => {
    try {
      const { status, category, search, page = 1, limit = 20 } = req.query;
      const conditions = [];
      const params = [];
      if (status) { params.push(status); conditions.push(`p.status = $${params.length}`); }
      if (category) { params.push(category); conditions.push(`p.category = $${params.length}`); }
      if (search) { params.push(`%${search}%`); conditions.push(`(p.title ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }
      const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const offset = (parseInt(page) - 1) * parseInt(limit);
      params.push(parseInt(limit), offset);
      const [result, count] = await Promise.all([
        pool.query(`SELECT p.*, u.first_name, u.last_name, u.profile_picture FROM projects p LEFT JOIN users u ON p.created_by = u.id ${where} ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params),
        pool.query(`SELECT COUNT(*) FROM projects p ${where}`, params.slice(0, -2))
      ]);
      const total = parseInt(count.rows[0].count);
      res.json({ success: true, data: result.rows.map(formatProject), pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } });
    } catch (error) {
      console.error("Error fetching admin projects:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },

  getDonationTrends: async (req, res) => {
    try {
      const { months = 6 } = req.query;
      const result = await pool.query(`
        SELECT
          EXTRACT(YEAR FROM created_at) AS year,
          EXTRACT(MONTH FROM created_at) AS month,
          SUM(amount) AS total,
          COUNT(*) AS count
        FROM project_donations
        WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '${parseInt(months)} months'
        GROUP BY year, month
        ORDER BY year ASC, month ASC
      `);
      res.json({ success: true, data: result.rows });
    } catch (error) {
      console.error("Error fetching donation trends:", error);
      res.status(500).json({ success: false, message: "Server error" });
    }
  },
};

// Helper to format project row consistently
function formatProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    long_description: row.long_description,
    category: row.category,
    status: row.status,
    location: row.location,
    cover_image: row.cover_image,
    start_date: row.start_date,
    target_date: row.target_date,
    funding_goal: parseFloat(row.funding_goal),
    current_amount: parseFloat(row.current_amount),
    funding_percentage: row.funding_goal > 0 ? Math.round((row.current_amount / row.funding_goal) * 100) : 0,
    accept_donations: row.accept_donations,
    accept_volunteers: row.accept_volunteers,
    max_volunteers: row.max_volunteers,
    is_featured: row.is_featured,
    votes_required: row.votes_required,
    volunteers_count: parseInt(row.volunteers_count) || 0,
    votes_count: parseInt(row.votes_count) || 0,
    donors_count: parseInt(row.donors_count) || 0,
    days_left: row.target_date ? Math.max(0, Math.ceil((new Date(row.target_date) - new Date()) / 86400000)) : null,
    created_by: row.first_name ? { id: row.created_by, first_name: row.first_name, last_name: row.last_name, profile_picture: row.profile_picture } : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export default projectController;