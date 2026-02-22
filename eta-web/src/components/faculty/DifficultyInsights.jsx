import React, { useState, useEffect } from 'react';
import {
    BarChart, Bar, ResponsiveContainer,
    XAxis, YAxis, CartesianGrid, Tooltip, Cell,
    PieChart, Pie
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import {
    AlertTriangle, BookOpen, Brain, Lightbulb,
    TrendingDown, FileText, Loader2, Sparkles,
    ChevronDown, ChevronUp, BarChart3, Target,
    ShieldAlert, Zap
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../api/axios.config';

const SEVERITY_CONFIG = {
    high: {
        color: '#ef4444',
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        text: 'text-red-500',
        label: 'Critical',
        icon: ShieldAlert
    },
    medium: {
        color: '#f59e0b',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        text: 'text-amber-500',
        label: 'Moderate',
        icon: AlertTriangle
    },
    low: {
        color: '#10b981',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/30',
        text: 'text-emerald-500',
        label: 'Minor',
        icon: Target
    }
};

const CHART_COLORS = ['#ef4444', '#f59e0b', '#8b5cf6', '#3b82f6', '#10b981', '#ec4899', '#06b6d4'];

export default function DifficultyInsights() {
    const { user } = useAuth();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [expandedTopic, setExpandedTopic] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchInsights = async () => {
            const userId = user?._id || user?.id;
            if (!userId) {
                setLoading(false);
                return;
            }
            try {
                const response = await apiClient.get(`/analytics/faculty/${userId}/difficulty-insights`);
                setData(response.data.data);
            } catch (err) {
                console.error('Difficulty insights fetch error:', err);
                setError('Failed to load difficulty insights');
            } finally {
                setLoading(false);
            }
        };
        fetchInsights();
    }, [user?._id, user?.id]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[500px] gap-4">
                <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-primary/5 flex items-center justify-center">
                        <Brain className="w-10 h-10 text-primary animate-pulse" />
                    </div>
                    <Loader2 className="w-6 h-6 text-primary animate-spin absolute -top-1 -right-1" />
                </div>
                <div className="text-center">
                    <p className="font-bold text-lg">Analyzing Difficulty Patterns</p>
                    <p className="text-muted-foreground text-sm mt-1">AI is clustering escalated queries into insights...</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 text-center">
                <div className="p-4 bg-red-500/10 rounded-full">
                    <AlertTriangle className="w-8 h-8 text-red-500" />
                </div>
                <p className="text-red-500 font-medium">{error}</p>
            </div>
        );
    }

    if (!data) return null;

    const { topics = [], materialInsights = [], materialBreakdown = [], overallSummary = '', stats = {} } = data;
    const hasInsights = topics.length > 0 || materialBreakdown.length > 0;

    // Empty state
    if (!hasInsights && stats.totalEscalated === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[500px] text-center p-8 bg-card rounded-2xl border border-dashed border-border/50">
                <div className="p-5 bg-emerald-500/10 rounded-full mb-6">
                    <Sparkles className="w-10 h-10 text-emerald-500" />
                </div>
                <h3 className="text-2xl font-bold mb-3">No Difficulty Patterns Detected</h3>
                <p className="text-muted-foreground max-w-md leading-relaxed">
                    When students' doubts get escalated to you (because the AI isn't confident enough),
                    this dashboard will analyze those queries and surface the topics and materials they struggle with most.
                </p>
                <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground bg-secondary px-4 py-2 rounded-full">
                    <Brain className="w-4 h-4" />
                    AI analysis activates once escalated doubts are recorded
                </div>
            </div>
        );
    }

    // Chart data for topic distribution
    const topicChartData = topics.map(t => ({
        name: t.name?.length > 20 ? t.name.substring(0, 20) + '...' : t.name,
        fullName: t.name,
        count: t.escalationCount || 0,
        severity: t.severity
    }));

    // Chart data for material breakdown pie
    const materialPieData = materialBreakdown.slice(0, 6).map(m => ({
        name: m.title?.length > 20 ? m.title.substring(0, 20) + '...' : m.title,
        fullName: m.title,
        value: m.escalationCount
    }));

    return (
        <div className="space-y-8 pb-12">
            {/* AI Summary Banner */}
            {overallSummary && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-500/10 via-blue-500/10 to-cyan-500/10 border border-primary/20 p-6"
                >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-10 -mt-10 blur-2xl" />
                    <div className="flex items-start gap-4 relative z-10">
                        <div className="p-3 bg-primary/10 rounded-xl flex-shrink-0">
                            <Brain className="w-6 h-6 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-widest text-primary mb-2">AI Analysis Summary</h3>
                            <p className="text-sm leading-relaxed font-medium">{overallSummary}</p>
                        </div>
                    </div>
                </motion.div>
            )}

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card p-6 border-l-4 border-red-500 shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Total Escalations</p>
                            <h3 className="text-3xl font-black">{stats.totalEscalated || 0}</h3>
                            <p className="text-xs text-red-500 font-bold mt-2 flex items-center gap-1">
                                <TrendingDown className="w-3 h-3" /> Doubts AI couldn't resolve
                            </p>
                        </div>
                        <div className="p-3 bg-red-500/10 text-red-500 rounded-2xl"><AlertTriangle className="w-6 h-6" /></div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="card p-6 border-l-4 border-purple-500 shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Courses Affected</p>
                            <h3 className="text-3xl font-black">{stats.coursesAffected || 0}</h3>
                            <p className="text-xs text-purple-500 font-bold mt-2 flex items-center gap-1">
                                <BookOpen className="w-3 h-3" /> With student struggles
                            </p>
                        </div>
                        <div className="p-3 bg-purple-500/10 text-purple-500 rounded-2xl"><BookOpen className="w-6 h-6" /></div>
                    </div>
                </motion.div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="card p-6 border-l-4 border-amber-500 shadow-sm">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1">Avg AI Confidence</p>
                            <h3 className="text-3xl font-black">{stats.avgConfidence || 0}%</h3>
                            <p className="text-xs text-amber-500 font-bold mt-2 flex items-center gap-1">
                                <Zap className="w-3 h-3" /> On escalated queries
                            </p>
                        </div>
                        <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl"><Target className="w-6 h-6" /></div>
                    </div>
                </motion.div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Topic Distribution Bar Chart */}
                {topicChartData.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="card p-6 bg-card border border-border/50 hover:shadow-xl transition-all"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2.5 bg-red-500/10 rounded-xl text-red-500">
                                <BarChart3 className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider">Pain Point Topics</h3>
                                <p className="text-[10px] text-muted-foreground font-medium uppercase">Ranked by escalation frequency</p>
                            </div>
                        </div>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topicChartData} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.1} />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} fontSize={11} width={130} />
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-card border rounded-lg p-3 shadow-lg text-xs">
                                                    <p className="font-bold mb-1">{d.fullName}</p>
                                                    <p>Escalations: <span className="font-bold">{d.count}</span></p>
                                                    <p>Severity: <span className={`font-bold ${SEVERITY_CONFIG[d.severity]?.text || ''}`}>
                                                        {SEVERITY_CONFIG[d.severity]?.label || d.severity}
                                                    </span></p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Bar dataKey="count" radius={[0, 6, 6, 0]} animationDuration={1500}>
                                        {topicChartData.map((entry, index) => (
                                            <Cell
                                                key={`cell-${index}`}
                                                fill={SEVERITY_CONFIG[entry.severity]?.color || CHART_COLORS[index % CHART_COLORS.length]}
                                            />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </motion.div>
                )}

                {/* Material Distribution Pie Chart */}
                {materialPieData.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="card p-6 bg-card border border-border/50 hover:shadow-xl transition-all"
                    >
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2.5 bg-purple-500/10 rounded-xl text-purple-500">
                                <FileText className="w-5 h-5" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider">Problem Materials</h3>
                                <p className="text-[10px] text-muted-foreground font-medium uppercase">Distribution of escalations by material</p>
                            </div>
                        </div>
                        <div className="h-[280px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={materialPieData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={90}
                                        paddingAngle={4}
                                        dataKey="value"
                                        nameKey="name"
                                    >
                                        {materialPieData.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0].payload;
                                            return (
                                                <div className="bg-card border rounded-lg p-3 shadow-lg text-xs">
                                                    <p className="font-bold mb-1">{d.fullName}</p>
                                                    <p>Escalations: <span className="font-bold">{d.value}</span></p>
                                                </div>
                                            );
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                            {/* Legend */}
                            <div className="flex flex-wrap gap-3 justify-center -mt-2">
                                {materialPieData.map((item, i) => (
                                    <div key={i} className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
                                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                                        {item.name}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </div>

            {/* AI Topic Cards */}
            {topics.length > 0 && (
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-primary/10 rounded-xl text-primary">
                            <Sparkles className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">AI-Identified Difficulty Topics</h3>
                            <p className="text-xs text-muted-foreground">Click a topic to see the recommendation</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <AnimatePresence>
                            {topics.map((topic, index) => {
                                const sev = SEVERITY_CONFIG[topic.severity] || SEVERITY_CONFIG.medium;
                                const SevIcon = sev.icon;
                                const isExpanded = expandedTopic === index;
                                return (
                                    <motion.div
                                        key={index}
                                        initial={{ opacity: 0, y: 15 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ delay: index * 0.08 }}
                                        className={`card border ${sev.border} overflow-hidden cursor-pointer hover:shadow-lg transition-all`}
                                        onClick={() => setExpandedTopic(isExpanded ? null : index)}
                                    >
                                        <div className="p-5">
                                            <div className="flex items-start justify-between gap-3 mb-3">
                                                <div className="flex items-center gap-3">
                                                    <div className={`p-2 ${sev.bg} rounded-lg`}>
                                                        <SevIcon className={`w-4 h-4 ${sev.text}`} />
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-sm">{topic.name}</h4>
                                                        <div className="flex items-center gap-2 mt-1">
                                                            <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${sev.bg} ${sev.text}`}>
                                                                {sev.label}
                                                            </span>
                                                            <span className="text-[10px] text-muted-foreground font-medium">
                                                                {topic.escalationCount} escalations
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronUp className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                                )}
                                            </div>

                                            <p className="text-xs text-muted-foreground leading-relaxed">{topic.description}</p>

                                            <AnimatePresence>
                                                {isExpanded && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={{ duration: 0.2 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="mt-4 pt-4 border-t border-border/50 space-y-3">
                                                            {/* Recommendation */}
                                                            <div className="bg-primary/5 rounded-xl p-4 border border-primary/10">
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <Lightbulb className="w-4 h-4 text-primary" />
                                                                    <span className="text-[10px] font-black uppercase tracking-widest text-primary">Recommendation</span>
                                                                </div>
                                                                <p className="text-xs leading-relaxed">{topic.recommendation}</p>
                                                            </div>

                                                            {/* Related Materials */}
                                                            {topic.relatedMaterials?.length > 0 && (
                                                                <div>
                                                                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Related Materials</p>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        {topic.relatedMaterials.map((mat, i) => (
                                                                            <span key={i} className="text-[10px] px-2.5 py-1 bg-secondary rounded-lg font-medium">
                                                                                {mat}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    </motion.div>
                                );
                            })}
                        </AnimatePresence>
                    </div>
                </div>
            )}

            {/* Material Insights (AI Suggestions) */}
            {materialInsights.length > 0 && (
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-amber-500/10 rounded-xl text-amber-500">
                            <Lightbulb className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold">Material Improvement Suggestions</h3>
                            <p className="text-xs text-muted-foreground">AI-generated recommendations for your most challenging materials</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        {materialInsights.map((mat, index) => (
                            <motion.div
                                key={index}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: index * 0.1 }}
                                className="card p-5 border hover:shadow-md transition-all"
                            >
                                <div className="flex flex-col md:flex-row md:items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-2">
                                            <FileText className="w-4 h-4 text-muted-foreground" />
                                            <h4 className="font-bold text-sm">{mat.title}</h4>
                                            <span className="text-[10px] px-2 py-0.5 bg-secondary rounded-full font-medium text-muted-foreground">
                                                {mat.courseName}
                                            </span>
                                        </div>
                                        <p className="text-xs text-red-500/80 font-medium mb-2">
                                            ⚠️ Issue: {mat.topIssue}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {mat.escalationCount} escalation{mat.escalationCount !== 1 ? 's' : ''}
                                        </p>
                                    </div>
                                    <div className="md:w-[300px] bg-emerald-500/5 rounded-xl p-4 border border-emerald-500/10 flex-shrink-0">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Lightbulb className="w-3.5 h-3.5 text-emerald-500" />
                                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Suggestion</span>
                                        </div>
                                        <p className="text-xs leading-relaxed">{mat.suggestion}</p>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                </div>
            )}

            {/* Raw Material Breakdown Table (always shown as fallback) */}
            {materialBreakdown.length > 0 && materialInsights.length === 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="card p-6 border"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-500">
                            <FileText className="w-5 h-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider">Material Escalation Breakdown</h3>
                            <p className="text-[10px] text-muted-foreground font-medium uppercase">Raw data — AI analysis in progress</p>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border/50">
                                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Material</th>
                                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Course</th>
                                    <th className="text-center py-3 px-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Escalations</th>
                                    <th className="text-center py-3 px-4 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Avg Confidence</th>
                                </tr>
                            </thead>
                            <tbody>
                                {materialBreakdown.map((mat, i) => (
                                    <tr key={i} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                                        <td className="py-3 px-4 font-medium">{mat.title}</td>
                                        <td className="py-3 px-4 text-muted-foreground">{mat.courseName}</td>
                                        <td className="py-3 px-4 text-center">
                                            <span className="px-2.5 py-1 bg-red-500/10 text-red-500 rounded-full text-xs font-bold">
                                                {mat.escalationCount}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${mat.avgConfidence < 40 ? 'bg-red-500' : mat.avgConfidence < 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                                        style={{ width: `${mat.avgConfidence}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs font-bold">{mat.avgConfidence}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </motion.div>
            )}
        </div>
    );
}
