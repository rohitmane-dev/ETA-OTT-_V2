import express from 'express';
import Doubt from '../models/Doubt.model.js';
import User from '../models/User.model.js';
import Course from '../models/Course.model.js';
import Content from '../models/Content.model.js';
import mongoose from 'mongoose';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import aiService from '../services/ai.service.js';

const router = express.Router();

/**
 * Get Student Analytics
 */
router.get('/student/:id', authenticate, attachUser, async (req, res) => {
    try {
        const studentId = new mongoose.Types.ObjectId(req.params.id);
        const user = await User.findById(studentId);

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // 1. Activity Trend (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const activityTrend = await Doubt.aggregate([
            { $match: { studentId, createdAt: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]);

        // 2. Subject Mastery (Doubts per Course)
        const subjectMastery = await Doubt.aggregate([
            { $match: { studentId } },
            { $group: { _id: "$courseId", doubtCount: { $sum: 1 }, resolvedCount: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } },
            { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } },
            { $unwind: "$course" },
            { $project: { name: "$course.name", proficiency: { $multiply: [{ $divide: ["$resolvedCount", { $max: ["$doubtCount", 1] }] }, 100] } } }
        ]);

        // 3. Overall Stats
        const stats = {
            totalDoubts: await Doubt.countDocuments({ studentId }),
            resolvedDoubts: await Doubt.countDocuments({ studentId, status: 'resolved' }),
            coursesEnrolled: user.progressStats?.coursesEnrolled || 0,
            completionRate: user.progressStats?.coursesCompleted / (user.progressStats?.coursesEnrolled || 1) * 100 || 0
        };

        // 4. Doubt Engagement (AI vs Faculty)
        const engagement = await Doubt.aggregate([
            { $match: { studentId } },
            { $group: { _id: "$source", count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            data: {
                activityTrend,
                subjectMastery,
                stats,
                engagement
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Get Faculty Analytics
 */
router.get('/faculty/:id', authenticate, attachUser, async (req, res) => {
    try {
        const facultyId = new mongoose.Types.ObjectId(req.params.id);

        // Find courses taught by this faculty (assuming courses have faculty references or createdBy)
        // For now, let's assume courses linked to branch/institution are what they oversee
        const user = await User.findById(facultyId);
        const branchIds = user.branchIds || [];

        // Pre-fetch course IDs to make aggregation simpler and more reliable
        const relevantCourseIds = await Course.find({
            $or: [
                { branchIds: { $in: branchIds } },
                { facultyIds: facultyId }
            ]
        }).distinct('_id');

        if (!relevantCourseIds || relevantCourseIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    engagementTrend: [],
                    coursePerformance: [],
                    avgResolutionTime: 0
                }
            });
        }

        // 1. Engagement (Monthly Active Users in their courses)
        const engagementTrend = await Doubt.aggregate([
            { $match: { courseId: { $in: relevantCourseIds } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                    doubts: { $sum: 1 },
                    activeStudents: { $addToSet: "$studentId" }
                }
            },
            { $project: { month: "$_id", doubts: 1, activeStudents: { $size: "$activeStudents" } } },
            { $sort: { "month": 1 } }
        ]);

        // 2. Course Performance
        const coursePerformance = await Doubt.aggregate([
            { $match: { courseId: { $in: relevantCourseIds } } },
            {
                $group: {
                    _id: "$courseId",
                    avgConfidence: { $avg: "$confidence" },
                    totalDoubts: { $sum: 1 },
                    resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
                }
            },
            { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } },
            { $unwind: "$course" },
            { $project: { name: "$course.name", load: "$totalDoubts", health: { $multiply: [{ $divide: ["$resolved", { $max: ["$totalDoubts", 1] }] }, 100] } } }
        ]);

        // 3. Resolution Speed (Filtered for faculty courses)
        const resolutionData = await Doubt.aggregate([
            {
                $match: {
                    courseId: { $in: relevantCourseIds },
                    status: 'resolved',
                    resolvedAt: { $ne: null }
                }
            },
            { $project: { timeToResolve: { $subtract: ["$resolvedAt", "$createdAt"] } } },
            { $group: { _id: null, avgTime: { $avg: "$timeToResolve" } } }
        ]);

        res.json({
            success: true,
            data: {
                engagementTrend,
                coursePerformance,
                avgResolutionTime: resolutionData[0]?.avgTime || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Get AI-Powered Difficulty Insights for Faculty
 * Analyzes escalated doubts to identify topics and materials students struggle with
 */
router.get('/faculty/:id/difficulty-insights', authenticate, attachUser, async (req, res) => {
    try {
        const facultyId = new mongoose.Types.ObjectId(req.params.id);
        const user = await User.findById(facultyId);
        const branchIds = user?.branchIds || [];

        // Get faculty's courses
        const relevantCourseIds = await Course.find({
            $or: [
                { branchIds: { $in: branchIds } },
                { facultyIds: facultyId }
            ]
        }).distinct('_id');

        if (!relevantCourseIds || relevantCourseIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    topics: [],
                    materialInsights: [],
                    overallSummary: 'No courses found for this faculty',
                    stats: { totalEscalated: 0, coursesAffected: 0, avgConfidence: 0 }
                }
            });
        }

        // 1. Aggregate escalated doubts grouped by content
        const escalatedByContent = await Doubt.aggregate([
            {
                $match: {
                    courseId: { $in: relevantCourseIds },
                    escalated: true
                }
            },
            {
                $group: {
                    _id: { courseId: '$courseId', contentId: '$contentId' },
                    queries: { $push: '$query' },
                    count: { $sum: 1 },
                    avgConfidence: { $avg: '$confidence' },
                    latestAt: { $max: '$createdAt' }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 20 }
        ]);

        // 2. Overall stats
        const totalEscalated = await Doubt.countDocuments({
            courseId: { $in: relevantCourseIds },
            escalated: true
        });

        const coursesAffected = await Doubt.distinct('courseId', {
            courseId: { $in: relevantCourseIds },
            escalated: true
        });

        const avgConfData = await Doubt.aggregate([
            { $match: { courseId: { $in: relevantCourseIds }, escalated: true } },
            { $group: { _id: null, avg: { $avg: '$confidence' } } }
        ]);

        // 3. Enrich with course and content names
        const contentIds = escalatedByContent
            .map(e => e._id.contentId)
            .filter(Boolean);
        const courseIds = escalatedByContent.map(e => e._id.courseId);

        const [contents, courses] = await Promise.all([
            Content.find({ _id: { $in: contentIds } }).select('title type').lean(),
            Course.find({ _id: { $in: courseIds } }).select('name code').lean()
        ]);

        const contentMap = {};
        contents.forEach(c => { contentMap[c._id.toString()] = c; });
        const courseMap = {};
        courses.forEach(c => { courseMap[c._id.toString()] = c; });

        // 4. Build data for AI analysis
        const doubtsData = escalatedByContent.map(group => ({
            courseName: courseMap[group._id.courseId?.toString()]?.name || 'Unknown Course',
            contentTitle: group._id.contentId
                ? (contentMap[group._id.contentId.toString()]?.title || 'General Query')
                : 'General Query',
            contentType: group._id.contentId
                ? (contentMap[group._id.contentId.toString()]?.type || 'unknown')
                : 'unknown',
            queries: group.queries,
            count: group.count,
            avgConfidence: Math.round(group.avgConfidence || 0)
        }));

        // 5. AI-powered topic analysis
        let aiInsights = { topics: [], materialInsights: [], overallSummary: '' };
        if (doubtsData.length > 0) {
            aiInsights = await aiService.analyzeDifficultyTopics(doubtsData);
        }

        // 6. Build raw material breakdown (non-AI fallback data)
        const materialBreakdown = doubtsData.map(d => ({
            title: d.contentTitle,
            courseName: d.courseName,
            type: d.contentType,
            escalationCount: d.count,
            avgConfidence: d.avgConfidence
        }));

        res.json({
            success: true,
            data: {
                ...aiInsights,
                materialBreakdown,
                stats: {
                    totalEscalated,
                    coursesAffected: coursesAffected.length,
                    avgConfidence: Math.round(avgConfData[0]?.avg || 0)
                }
            }
        });
    } catch (error) {
        console.error('Difficulty insights error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
