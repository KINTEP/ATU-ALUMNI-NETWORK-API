// src/controllers/jobController.js
import pool from "../config/db.js";

const jobController = {

    // ==================== CREATE JOB (Admin only) ====================
    createJob: async (req, res) => {
        try {
            // ✅ FIX: was req.body.posted_by — admin could post as any user
            const posted_by = req.user.id || req.user.userId;

            const {
                company_name, company_logo, company_website, industry,
                job_title, job_description, job_type, location, location_type,
                salary_min, salary_max, salary_currency, salary_period,
                experience_level, education_required, skills_required,
                responsibilities, qualifications, benefits,
                application_deadline, application_url, application_email,
                positions_available, is_featured
            } = req.body;

            if (!company_name || !job_title || !job_description || !job_type || !location) {
                return res.status(400).json({
                    success: false,
                    error: "Company name, job title, description, job type, and location are required"
                });
            }

            const validJobTypes = ['Full-time', 'Part-time', 'Contract', 'Internship', 'Temporary'];
            if (!validJobTypes.includes(job_type)) {
                return res.status(400).json({
                    success: false,
                    error: `Job type must be one of: ${validJobTypes.join(', ')}`
                });
            }

            const result = await pool.query(
                `INSERT INTO jobs (
                    posted_by, company_name, company_logo, company_website, industry,
                    job_title, job_description, job_type, location, location_type,
                    salary_min, salary_max, salary_currency, salary_period,
                    experience_level, education_required, skills_required,
                    responsibilities, qualifications, benefits,
                    application_deadline, application_url, application_email,
                    positions_available, is_featured
                )
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
                RETURNING *`,
                [
                    posted_by, company_name, company_logo || null, company_website || null, industry || null,
                    job_title, job_description, job_type, location, location_type || null,
                    salary_min || null, salary_max || null, salary_currency || 'GHS', salary_period || null,
                    experience_level || null, education_required || null, skills_required || null,
                    responsibilities || null, qualifications || null, benefits || null,
                    application_deadline || null, application_url || null, application_email || null,
                    positions_available || 1, is_featured || false
                ]
            );

            res.status(201).json({
                success: true,
                message: "Job created successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Create job error:", error);
            res.status(500).json({ success: false, error: "Failed to create job" });
        }
    },

    // ==================== GET ALL JOBS ====================
    getAllJobs: async (req, res) => {
        try {
            const {
                job_type, location, location_type, experience_level, industry,
                company_name, salary_min, salary_max, skills, is_featured,
                posted_within_days, search,
                page = 1, limit = 20,
                sort_by = 'created_at', sort_order = 'DESC'
            } = req.query;

            let queryText = `
                SELECT 
                    j.*,
                    u.first_name || ' ' || u.last_name as posted_by_name,
                    u.email as posted_by_email
                FROM jobs j
                LEFT JOIN users u ON j.posted_by = u.id
                WHERE j.is_active = true
            `;

            const queryParams = [];
            let paramCount = 0;

            if (job_type) {
                paramCount++;
                queryText += ` AND j.job_type = $${paramCount}`;
                queryParams.push(job_type);
            }
            if (location) {
                paramCount++;
                queryText += ` AND j.location ILIKE $${paramCount}`;
                queryParams.push(`%${location}%`);
            }
            if (location_type) {
                paramCount++;
                queryText += ` AND j.location_type = $${paramCount}`;
                queryParams.push(location_type);
            }
            if (experience_level) {
                paramCount++;
                queryText += ` AND j.experience_level = $${paramCount}`;
                queryParams.push(experience_level);
            }
            if (industry) {
                paramCount++;
                queryText += ` AND j.industry ILIKE $${paramCount}`;
                queryParams.push(`%${industry}%`);
            }
            if (company_name) {
                paramCount++;
                queryText += ` AND j.company_name ILIKE $${paramCount}`;
                queryParams.push(`%${company_name}%`);
            }
            if (salary_min) {
                paramCount++;
                queryText += ` AND j.salary_max >= $${paramCount}`;
                queryParams.push(salary_min);
            }
            if (salary_max) {
                paramCount++;
                queryText += ` AND j.salary_min <= $${paramCount}`;
                queryParams.push(salary_max);
            }
            if (skills) {
                paramCount++;
                queryText += ` AND j.skills_required && $${paramCount}`;
                queryParams.push(`{${skills}}`);
            }
            if (is_featured === 'true') {
                queryText += ` AND j.is_featured = true`;
            }
            if (posted_within_days) {
                // ✅ parseInt sanitizes against injection; interval is safe
                const days = parseInt(posted_within_days);
                if (!isNaN(days) && days > 0) {
                    paramCount++;
                    queryText += ` AND j.created_at >= NOW() - ($${paramCount} * INTERVAL '1 day')`;
                    queryParams.push(days);
                }
            }
            if (search) {
                paramCount++;
                queryText += ` AND (
                    j.job_title ILIKE $${paramCount} OR 
                    j.job_description ILIKE $${paramCount} OR 
                    j.company_name ILIKE $${paramCount}
                )`;
                queryParams.push(`%${search}%`);
            }

            // Count
            const countQuery = queryText.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM');
            const countResult = await pool.query(countQuery, queryParams);
            const totalJobs = parseInt(countResult.rows[0].count);

            // Sort & paginate
            const validSortFields = ['created_at', 'job_title', 'salary_min', 'application_deadline', 'views_count'];
            const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
            const order = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const offset = (page - 1) * limit;

            queryText += ` ORDER BY j.${sortField} ${order} LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            queryParams.push(parseInt(limit), offset);

            const result = await pool.query(queryText, queryParams);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                total: totalJobs,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(totalJobs / limit)
                },
                data: result.rows
            });

        } catch (error) {
            console.error("Get jobs error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch jobs" });
        }
    },

    // ==================== GET JOB BY ID ====================
    getJobById: async (req, res) => {
        try {
            const { id } = req.params;

            if (isNaN(id)) {
                return res.status(400).json({ success: false, error: "Invalid job ID" });
            }

            const result = await pool.query(
                `SELECT 
                    j.*,
                    u.first_name || ' ' || u.last_name as posted_by_name,
                    u.email as posted_by_email,
                    u.role as posted_by_role
                FROM jobs j
                LEFT JOIN users u ON j.posted_by = u.id
                WHERE j.id = $1 AND j.is_active = true`,
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Job not found" });
            }

            res.status(200).json({ success: true, data: result.rows[0] });

        } catch (error) {
            console.error("Get job error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch job" });
        }
    },

    // ==================== UPDATE JOB ====================
    updateJob: async (req, res) => {
        try {
            const { id } = req.params;

            if (isNaN(id)) {
                return res.status(400).json({ success: false, error: "Invalid job ID" });
            }

            const jobCheck = await pool.query("SELECT id FROM jobs WHERE id = $1", [id]);
            if (jobCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Job not found" });
            }

            const allowedFields = [
                'company_name', 'company_logo', 'company_website', 'industry',
                'job_title', 'job_description', 'job_type', 'location', 'location_type',
                'salary_min', 'salary_max', 'salary_currency', 'salary_period',
                'experience_level', 'education_required', 'skills_required',
                'responsibilities', 'qualifications', 'benefits',
                'application_deadline', 'application_url', 'application_email',
                'positions_available', 'is_featured', 'is_active'
            ];

            const updates = [];
            const values = [];
            let paramCount = 0;

            Object.keys(req.body).forEach(key => {
                if (allowedFields.includes(key)) {
                    paramCount++;
                    updates.push(`${key} = $${paramCount}`);
                    values.push(req.body[key]);
                }
            });

            if (updates.length === 0) {
                return res.status(400).json({ success: false, error: "No valid fields to update" });
            }

            values.push(id);
            paramCount++;

            const result = await pool.query(
                `UPDATE jobs SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
                values
            );

            res.status(200).json({
                success: true,
                message: "Job updated successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Update job error:", error);
            res.status(500).json({ success: false, error: "Failed to update job" });
        }
    },

    // ==================== DELETE JOB (soft delete) ====================
    deleteJob: async (req, res) => {
        try {
            const { id } = req.params;

            if (isNaN(id)) {
                return res.status(400).json({ success: false, error: "Invalid job ID" });
            }

            const result = await pool.query(
                "UPDATE jobs SET is_active = false WHERE id = $1 RETURNING id",
                [id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({ success: false, error: "Job not found" });
            }

            res.status(200).json({ success: true, message: "Job deleted successfully" });

        } catch (error) {
            console.error("Delete job error:", error);
            res.status(500).json({ success: false, error: "Failed to delete job" });
        }
    },

    // ==================== INCREMENT VIEW COUNT ====================
    incrementViewCount: async (req, res) => {
        try {
            await pool.query(
                "UPDATE jobs SET views_count = views_count + 1 WHERE id = $1",
                [req.params.id]
            );
            res.status(200).json({ success: true, message: "View count updated" });
        } catch (error) {
            console.error("Increment view error:", error);
            res.status(500).json({ success: false, error: "Failed to update view count" });
        }
    },

    // ==================== APPLY TO JOB ====================
    applyToJob: async (req, res) => {
        try {
            const { id } = req.params;
            // ✅ FIX: was req.body.user_id — user could apply as someone else
            const userId = req.user.id || req.user.userId;
            const { cover_letter, resume_url } = req.body;

            const jobCheck = await pool.query(
                "SELECT id, application_deadline FROM jobs WHERE id = $1 AND is_active = true",
                [id]
            );

            if (jobCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Job not found or no longer active" });
            }

            const job = jobCheck.rows[0];
            if (job.application_deadline && new Date(job.application_deadline) < new Date()) {
                return res.status(400).json({ success: false, error: "Application deadline has passed" });
            }

            const existingApplication = await pool.query(
                "SELECT id FROM job_applications WHERE job_id = $1 AND user_id = $2",
                [id, userId]
            );

            if (existingApplication.rows.length > 0) {
                return res.status(409).json({ success: false, error: "You have already applied to this job" });
            }

            const result = await pool.query(
                `INSERT INTO job_applications (job_id, user_id, cover_letter, resume_url)
                 VALUES ($1, $2, $3, $4) RETURNING *`,
                [id, userId, cover_letter || null, resume_url || null]
            );

            res.status(201).json({
                success: true,
                message: "Application submitted successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Apply to job error:", error);
            res.status(500).json({ success: false, error: "Failed to submit application" });
        }
    },

    // ==================== GET MY APPLICATIONS ====================
    getMyApplications: async (req, res) => {
        try {
            // ✅ FIX: was req.query.user_id — anyone could see anyone's applications
            const userId = req.user.id || req.user.userId;
            const { status, page = 1, limit = 20 } = req.query;

            let queryText = `
                SELECT 
                    ja.*,
                    j.job_title, j.company_name, j.company_logo,
                    j.location, j.job_type, j.is_active as job_is_active
                FROM job_applications ja
                JOIN jobs j ON ja.job_id = j.id
                WHERE ja.user_id = $1
            `;

            const queryParams = [userId];
            let paramCount = 1;

            if (status) {
                paramCount++;
                queryText += ` AND ja.status = $${paramCount}`;
                queryParams.push(status);
            }

            const countQuery = queryText.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM');
            const countResult = await pool.query(countQuery, queryParams);
            const totalApplications = parseInt(countResult.rows[0].count);

            const offset = (page - 1) * limit;
            queryText += ` ORDER BY ja.applied_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            queryParams.push(parseInt(limit), offset);

            const result = await pool.query(queryText, queryParams);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                total: totalApplications,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(totalApplications / limit)
                },
                data: result.rows
            });

        } catch (error) {
            console.error("Get applications error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch applications" });
        }
    },

    // ==================== GET JOB APPLICATIONS (Admin) ====================
    getJobApplications: async (req, res) => {
        try {
            const { id } = req.params;
            const { status, page = 1, limit = 20 } = req.query;

            let queryText = `
                SELECT 
                    ja.*,
                    u.first_name, u.last_name, u.email, u.phone_number,
                    u.graduation_year, u.program_of_study,
                    u.current_company, u.linkedin_url
                FROM job_applications ja
                JOIN users u ON ja.user_id = u.id
                WHERE ja.job_id = $1
            `;

            const queryParams = [id];
            let paramCount = 1;

            if (status) {
                paramCount++;
                queryText += ` AND ja.status = $${paramCount}`;
                queryParams.push(status);
            }

            const countQuery = queryText.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM');
            const countResult = await pool.query(countQuery, queryParams);
            const totalApplications = parseInt(countResult.rows[0].count);

            const offset = (page - 1) * limit;
            queryText += ` ORDER BY ja.applied_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
            queryParams.push(parseInt(limit), offset);

            const result = await pool.query(queryText, queryParams);

            res.status(200).json({
                success: true,
                count: result.rows.length,
                total: totalApplications,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total_pages: Math.ceil(totalApplications / limit)
                },
                data: result.rows
            });

        } catch (error) {
            console.error("Get job applications error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch applications" });
        }
    },

    // ==================== UPDATE APPLICATION STATUS (Admin) ====================
    updateApplicationStatus: async (req, res) => {
        try {
            const { id, appId } = req.params;
            const { status, notes } = req.body;
            // ✅ FIX: was req.body.reviewed_by — admin could credit another user
            const reviewed_by = req.user.id || req.user.userId;

            const validStatuses = ['pending', 'reviewing', 'shortlisted', 'rejected', 'accepted', 'withdrawn'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: `Status must be one of: ${validStatuses.join(', ')}`
                });
            }

            const result = await pool.query(
                `UPDATE job_applications 
                 SET status = $1, notes = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP
                 WHERE id = $4 AND job_id = $5
                 RETURNING *`,
                [status, notes || null, reviewed_by, appId, id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Application not found" });
            }

            res.status(200).json({
                success: true,
                message: "Application status updated successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Update application status error:", error);
            res.status(500).json({ success: false, error: "Failed to update application status" });
        }
    },

    // ==================== SAVE JOB ====================
    saveJob: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id || req.user.userId;

            const jobCheck = await pool.query(
                "SELECT id FROM jobs WHERE id = $1 AND is_active = true",
                [id]
            );

            if (jobCheck.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Job not found" });
            }

            const existingSave = await pool.query(
                "SELECT id FROM saved_jobs WHERE job_id = $1 AND user_id = $2",
                [id, userId]
            );

            if (existingSave.rows.length > 0) {
                return res.status(409).json({ success: false, error: "Job already saved" });
            }

            const result = await pool.query(
                "INSERT INTO saved_jobs (job_id, user_id) VALUES ($1, $2) RETURNING *",
                [id, userId]
            );

            res.status(201).json({
                success: true,
                message: "Job saved successfully",
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Save job error:", error);
            res.status(500).json({ success: false, error: "Failed to save job" });
        }
    },

    // ==================== UNSAVE JOB ====================
    unsaveJob: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id || req.user.userId;

            const result = await pool.query(
                "DELETE FROM saved_jobs WHERE job_id = $1 AND user_id = $2 RETURNING *",
                [id, userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "Saved job not found" });
            }

            res.status(200).json({ success: true, message: "Job unsaved successfully" });

        } catch (error) {
            console.error("Unsave job error:", error);
            res.status(500).json({ success: false, error: "Failed to unsave job" });
        }
    },

    // ==================== GET SAVED JOB IDs ====================
    getSavedJobIds: async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;

            const result = await pool.query(
                "SELECT job_id FROM saved_jobs WHERE user_id = $1",
                [userId]
            );

            res.status(200).json({
                success: true,
                data: result.rows.map(row => row.job_id)
            });

        } catch (error) {
            console.error("Get saved job IDs error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch saved job IDs" });
        }
    },

    // ==================== GET SAVED JOBS ====================
    getSavedJobs: async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            const countResult = await pool.query(
                `SELECT COUNT(*) FROM saved_jobs sj
                 JOIN jobs j ON sj.job_id = j.id
                 WHERE sj.user_id = $1 AND j.is_active = true`,
                [userId]
            );
            const totalSaved = parseInt(countResult.rows[0].count);

            const result = await pool.query(
                `SELECT 
                    j.*,
                    u.first_name || ' ' || u.last_name as posted_by_name,
                    u.email as posted_by_email
                 FROM saved_jobs sj
                 JOIN jobs j ON sj.job_id = j.id
                 LEFT JOIN users u ON j.posted_by = u.id
                 WHERE sj.user_id = $1 AND j.is_active = true
                 ORDER BY sj.saved_at DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );

            res.status(200).json({
                success: true,
                total: totalSaved,
                data: result.rows,
                pagination: {
                    page,
                    limit,
                    total_pages: Math.ceil(totalSaved / limit)
                }
            });

        } catch (error) {
            console.error("Get saved jobs error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch saved jobs" });
        }
    },

    // ==================== GET JOB STATS ====================
    getJobStats: async (req, res) => {
        try {
            const [totalResult, typeResult, locationResult, companiesResult,
                   applicationsResult, statusResult, recentResult, viewedResult, appliedResult] =
                await Promise.all([
                    pool.query("SELECT COUNT(*) as total FROM jobs WHERE is_active = true"),
                    pool.query(`SELECT job_type, COUNT(*) as count FROM jobs WHERE is_active = true GROUP BY job_type ORDER BY count DESC`),
                    pool.query(`SELECT location, COUNT(*) as count FROM jobs WHERE is_active = true GROUP BY location ORDER BY count DESC LIMIT 10`),
                    pool.query(`SELECT company_name, COUNT(*) as job_count FROM jobs WHERE is_active = true GROUP BY company_name ORDER BY job_count DESC LIMIT 10`),
                    pool.query("SELECT COUNT(*) as total FROM job_applications"),
                    pool.query(`SELECT status, COUNT(*) as count FROM job_applications GROUP BY status ORDER BY count DESC`),
                    pool.query(`SELECT COUNT(*) as count FROM jobs WHERE is_active = true AND created_at >= NOW() - INTERVAL '30 days'`),
                    pool.query(`SELECT id, job_title, company_name, views_count FROM jobs WHERE is_active = true ORDER BY views_count DESC LIMIT 10`),
                    pool.query(`SELECT id, job_title, company_name, applications_count FROM jobs WHERE is_active = true ORDER BY applications_count DESC LIMIT 10`)
                ]);

            res.status(200).json({
                success: true,
                data: {
                    total_jobs: parseInt(totalResult.rows[0].total),
                    total_applications: parseInt(applicationsResult.rows[0].total),
                    recent_jobs_30_days: parseInt(recentResult.rows[0].count),
                    by_job_type: typeResult.rows,
                    by_location: locationResult.rows,
                    top_companies: companiesResult.rows,
                    applications_by_status: statusResult.rows,
                    most_viewed_jobs: viewedResult.rows,
                    most_applied_jobs: appliedResult.rows
                }
            });

        } catch (error) {
            console.error("Get job stats error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch job statistics" });
        }
    }
};

export default jobController;