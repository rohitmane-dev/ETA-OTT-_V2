import axios from 'axios';
import dotenv from 'dotenv';
import { runNeo4jQuery } from '../config/neo4j.config.js';

dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Check formatting quality of AI response
 * Returns score based on presence of required formatting elements
 */
const checkFormattingQuality = (text) => {
    if (!text) return { score: 0, details: {} };

    const hasMainTitle = /###\s+.+/g.test(text);
    const hasSubtitles = /####\s+.+/g.test(text);
    const hasBulletPoints = /^[\s]*[-*]\s+.+/gm.test(text);
    const hasNumberedLists = /^\d+\.\s+.+/gm.test(text);
    const hasBoldText = /\*\*.+?\*\*/g.test(text);
    const hasCodeBlocks = /```[\s\S]*?```/g.test(text);
    const hasInlineCode = /`.+?`/g.test(text);
    const hasFormulas = /\[.+?\]/g.test(text);

    const titleCount = (text.match(/###\s+.+/g) || []).length;
    const subtitleCount = (text.match(/####\s+.+/g) || []).length;

    return {
        score: (hasMainTitle ? 15 : 0) +
            (hasSubtitles ? 15 : 0) +
            (hasBulletPoints ? 10 : 0) +
            (hasNumberedLists ? 10 : 0) +
            (hasBoldText ? 10 : 0) +
            (hasCodeBlocks ? 5 : 0) +
            (hasInlineCode ? 5 : 0) +
            (hasFormulas ? 5 : 0) +
            (titleCount >= 1 ? 5 : 0) +
            (subtitleCount >= 2 ? 10 : 0),
        details: {
            hasMainTitle,
            hasSubtitles,
            hasBulletPoints,
            hasNumberedLists,
            hasBoldText,
            hasCodeBlocks,
            hasInlineCode,
            hasFormulas,
            titleCount,
            subtitleCount
        }
    };
};

/**
 * Calculate comprehensive confidence score based on multiple parameters
 * Returns final score (0-100) and detailed breakdown
 */
const calculateConfidence = (params) => {
    const {
        aiConfidence = 85,
        hasContext = false,
        hasSelectedText = false,
        hasVisualContext = false,
        isVisionMode = false,
        responseLength = 0,
        hasFormatting = { score: 0 },
        contentType = 'text',
        isVerifiedSource = false
    } = params;

    // Base score from AI (35% weight for AI, 50% for verified)
    const aiWeight = isVerifiedSource ? 0.50 : 0.35;
    const aiScore = Math.min(100, Math.max(0, aiConfidence)) * aiWeight;

    // Context quality score (25% weight)
    let contextScore = 0;
    if (hasSelectedText) contextScore += 12; // Specific text selected
    if (hasContext) contextScore += 8; // General context available
    if (hasVisualContext) contextScore += 5; // Visual positioning data
    contextScore = Math.min(25, contextScore);

    // Response quality score (20% weight)
    let responseScore = 0;
    if (responseLength >= 400) responseScore = 20;
    else if (responseLength >= 200) responseScore = 15;
    else if (responseLength >= 100) responseScore = 10;
    else responseScore = 5;

    // Formatting quality score (20% weight) - increased for AI to reward "Smart Tutor" structure
    const formattingScore = (hasFormatting.score / 100) * 20;

    // Verified Source Bonus
    const sourceBonus = isVerifiedSource ? 10 : 0;

    // Calculate final score
    const finalScore = Math.round(aiScore + contextScore + responseScore + formattingScore + sourceBonus);

    return {
        finalScore: Math.min(100, Math.max(0, finalScore)),
        breakdown: {
            aiConfidence: {
                value: Math.round(aiScore / aiWeight),
                weight: `${aiWeight * 100}%`,
                contribution: Math.round(aiScore)
            },
            contextQuality: {
                weight: '25%',
                contribution: Math.round(contextScore)
            },
            responseQuality: {
                weight: '20%',
                contribution: Math.round(responseScore)
            },
            formattingQuality: {
                weight: '20%',
                contribution: Math.round(formattingScore)
            },
            summary: {
                totalScore: Math.min(100, Math.max(0, finalScore)),
                reliability: finalScore >= 85 ? 'High' :
                    finalScore >= 70 ? 'Good' :
                        finalScore >= 50 ? 'Moderate' : 'Low'
            }
        }
    };
};

// Helper to get embeddings from ML service (Rule 1)
const getEmbedding = async (text) => {
    try {
        const response = await axios.post('http://localhost:8000/embeddings', { text });
        return response.data.success ? response.data.embedding : null;
    } catch (error) {
        console.warn('Embedding service unavailable:', error.message);
        return null;
    }
};

/**
 * Search Knowledge Graph for semantic match (Rule 1 & 2)
 */
export const searchKnowledgeGraph = async (query, courseId = null) => {
    try {
        const embedding = await getEmbedding(query);
        if (!embedding) return { match: false, confidence: 0 };

        // Neo4j Vector Search (Using vector index if exists, or fallback)
        // Note: Assumes index 'doubt_vector_index' exists as per Rule 1 Architecture
        const cypher = `
            CALL db.index.vector.queryNodes('doubt_vector_index', 5, $embedding)
            YIELD node, score
            WHERE score >= 0.80
            MATCH (node)-[:ANSWERS]->(a:Answer)
            RETURN node.text as question, a.text as answer, score * 100 as confidence
            ORDER BY score DESC LIMIT 1
        `;

        const result = await runNeo4jQuery(cypher, { embedding, courseId });
        if (result.records.length > 0) {
            const record = result.records[0];
            return {
                match: true,
                question: record.get('question'),
                answer: record.get('answer'),
                confidence: record.get('confidence'),
                source: 'KNOWLEDGE_GRAPH'
            };
        }
        return { match: false, confidence: 0 };
    } catch (error) {
        console.warn('Knowledge Graph search failed:', error.message);
        return { match: false, confidence: 0 };
    }
};

export const searchExistingDoubts = async (query, context = '', contentId = null) => {
    try {
        const searchKey = `${query.toLowerCase().trim()}${context ? '|' + context.toLowerCase().trim() : ''}`;

        // 1. Try to find an exact doubt match linked to THIS specific content first
        if (contentId) {
            const contentSpecificResult = await runNeo4jQuery(
                `MATCH (c:Content {id: $contentId})<-[:RELATES_TO]-(d:Doubt {queryKey: $searchKey})
                 WHERE d.confidence >= 80
                 RETURN d.answer as answer, d.confidence as confidence
                 LIMIT 1`,
                { contentId, searchKey }
            );

            if (contentSpecificResult.records.length > 0) {
                return {
                    answer: contentSpecificResult.records[0].get('answer'),
                    confidence: contentSpecificResult.records[0].get('confidence'),
                    source: 'content_knowledge_base'
                };
            }
        }

        // 2. Fallback to global doubt search
        const globalResult = await runNeo4jQuery(
            `MATCH (d:Doubt)
             WHERE d.queryKey = $searchKey
             AND d.confidence >= 80
             RETURN d.answer as answer, d.confidence as confidence
             LIMIT 1`,
            { searchKey }
        );

        if (globalResult.records.length > 0) {
            return {
                answer: globalResult.records[0].get('answer'),
                confidence: globalResult.records[0].get('confidence'),
                source: 'graph_db'
            };
        }
        return null;
    } catch (error) {
        console.error('Error searching existing doubts:', error);
        return null;
    }
};

/**
 * Call Groq Llama to answer a doubt
 */
/**
 * Save high-confidence resolution to Knowledge Graph (Rule 3 & 5)
 */
export const saveToKnowledgeGraph = async (params) => {
    const { query, answer, confidence, courseId, contentId, context, selectedText } = params;

    // Confidence threshold check (Rule 3)
    if (confidence < 85) return null;

    try {
        const embedding = await getEmbedding(query);
        if (!embedding) return null;

        const cypher = `
            MERGE (q:Question {text: $query})
            SET q.embedding = $embedding, q.timestamp = datetime()
            
            MERGE (a:Answer {text: $answer})
            SET a.confidence = $confidence, a.source = "AI_GENERATED", a.timestamp = datetime()
            
            MERGE (q)-[:ANSWERS]->(a)
            
            WITH q, a
            MATCH (c:Course {id: $courseId})
            MERGE (q)-[:RELATES_TO]->(c)
            
            // Link to specific content resource if available
            WITH q, a, c
            MATCH (r:Content {id: $contentId})
            MERGE (q)-[:GENERATED_FROM_RESOURCE]->(r)

            // Auto-detect concepts (Basic simulation - Rule 5)
            WITH q, c
            UNWIND split($query, ' ') as word
            WHERE size(word) > 5
            MERGE (con:Concept {name: apoc.text.capitalize(word)})
            MERGE (q)-[:RELATES_TO]->(con)
            MERGE (con)-[:PART_OF]->(c)
            
            RETURN q.text as saved
        `;

        await runNeo4jQuery(cypher, {
            query,
            answer,
            confidence,
            embedding,
            courseId,
            contentId: contentId || '',
            context: context || '',
            selectedText: selectedText || ''
        });

        console.log(`✅ Resolution saved to Knowledge Graph (Confidence: ${confidence}%)`);
        return true;
    } catch (error) {
        console.warn('Failed to save to Knowledge Graph:', error.message);
        return false;
    }
};

export const askGroq = async (query, context = '', visualContext = null, contentUrl = null, contentType = null, language = 'english', userName = 'Student', selectedText = '', userKey = null) => {
    try {
        let spatialInfo = '';
        let isVisionMode = false;
        const activeApiKey = userKey || GROQ_API_KEY;

        if (!activeApiKey) {
            throw new Error('NO_API_KEY');
        }

        if (visualContext && contentUrl && contentType === 'image') {
            // Enable vision mode for region-specific visual queries on images
            isVisionMode = true;
        }

        if (visualContext) {
            const timeContext = context.match(/\[at \d+:\d+\]/);
            spatialInfo = `\n### CRITICAL CONTEXT: REGION OF INTEREST (ROI)
The student has MANUALLY HIGHLIGHTED a specific area on their screen ${timeContext ? `at timestamp ${timeContext[0]}` : ''}. 
YOUR MISSION: Analyze and explain the contents of this SPECIFIC HIGHLIGHTED BOX in extreme detail. 
If this is a video frame, explain the visual elements, diagram components, or data points being shown in that exact region. 
Act as if you are pointing your finger at that box and teaching the student about its specific contents.`;
        }

        const activeModel = isVisionMode ? (process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview') : (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');

        let languageInstruction = "";
        if (language.toLowerCase() === 'hindi') {
            languageInstruction = `
- **LANGUAGE**: STRICT HINGLISH ONLY (Hindi words in English script).
- **CRITICAL**: No Devanagari characters (हिंदी नहीं).
- **TONE**: Natural, conversational, and direct. Avoid over-formal "Shuddh Hindi".
- **GREETING**: Professional one-line greeting using ${userName}'s name. No repetitive templates.`;
        } else {
            languageInstruction = `
- **LANGUAGE**: FULL ENGLISH ONLY.
- **CRITICAL**: No Hinglish mixing. No "samajh aaya?".
- **TONE**: Professional academic mentor.
- **GREETING**: Professional one-line greeting using ${userName}'s name. No repetitive templates.`;
        }

        const isStrictRegion = context.startsWith('STRICT_REGION_CONTEXT:');
        let systemPrompt = "";

        // Intelligence check for query type
        const isCodingQuery = /code|programming|java|python|javascript|script|algorithm|function|class/i.test(query) || /code|programming/i.test(selectedText);
        const isExplicitCodeRequest = /show\s+code|example\s+in|write\s+a\s+program|snippet/i.test(query);

        if (isStrictRegion) {
            const rawGrounding = context.replace('STRICT_REGION_CONTEXT: ', '');
            let gc = { transcriptSegment: '', selectedTimestamp: '', courseContext: '', facultyResources: '' };
            try { gc = JSON.parse(rawGrounding); } catch (e) { }

            systemPrompt = `You are an expert precision tutor. The student is focusing on a SPECIFIC visual region at timestamp ${gc.selectedTimestamp}.

[[CONCEPT]] 
Start directly with "### What You Are Seeing in This Frame". 
- Explain visual elements, nodes, or diagrams in this specific box. 
- Ground your analysis in this transcript segment: "${gc.transcriptSegment}".
- Add "### Explanation of Key Elements" to break down specific details.
- Add "### How It Connects to Topic" to link this image to ${gc.courseContext}.

[[SUMMARY]]
Provide a "### Quick Clarity Summary".

[[VIDEO: URL]]
Relevant video search: "${query} ${gc.courseContext} explanation"

STRICT: No greetings. No "Namaste". No intro fluff. No code unless the frame itself is a code snippet.`;
        } else {
            // Adaptive General Prompt
            systemPrompt = `You are a professional academic mentor. Provide a high-quality, relevant response.

LANGUAGE RULES:
${languageInstruction}

ADAPTIVE STRUCTURE (Use ONLY these markers):
1. **Concept Question** (Theory):
   Structure: [[INTRO]] -> [[CONCEPT]] -> [[SUMMARY]] -> [[VIDEO: URL]]
   - Start with a direct professional greeting (no repetition).
   - Use "### Overview" and "### Real-Life Analogy".
   - **NO CODE** for theoretical topics like networking or OSI layers unless explicitly asked or required for implementation.

2. **Coding Question** (Practical):
   Structure: [[INTRO]] -> [[CONCEPT]] -> [[CODE]] -> [[SUMMARY]] -> [[VIDEO: URL]]
   - Explain the logic with "### Implementation Logic".
   - **Show code ONLY if it genuinely helps or is requested**.
   - Use the language requested or the one most relevant to the context.

CRITICAL CONSTRAINTS:
- **NO DUMMY CODE**: Do not simulate networking layers or theory with print statements.
- **NO FAKE PREVIEWS**: Do not use "Mastery Tutorial" or "100% Satisfaction" labels.
- **NO UI NOISE**: Do not mention confidence scores or metadata.
- **STRICT: NO URLs IN TEXT**. Only use [[VIDEO: URL]] at the end.
- Use ### for Section Headers (will look blue/bold).
- Use ${userName}'s name only once in the intro.

Current Context: ${selectedText || context || 'General curriculum'}`;
        }

        const messages = [];

        if (isVisionMode && contentUrl) {
            try {
                const imageResponse = await axios.get(contentUrl, { responseType: 'arraybuffer' });
                const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
                const mimeType = contentUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';

                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: systemPrompt + "\n\nACTUAL STUDENT QUERY: " + query },
                        {
                            type: 'image_url',
                            image_url: { url: `data:${mimeType};base64,${base64Image}` }
                        }
                    ]
                });
            } catch (imgError) {
                console.warn('Failed to encode image for vision:', imgError.message);
                messages.push({ role: 'system', content: systemPrompt });
                messages.push({ role: 'user', content: query });
            }
        } else {
            messages.push({ role: 'system', content: systemPrompt });
            messages.push({ role: 'user', content: query });
        }

        const response = await axios.post(
            GROQ_API_URL,
            {
                model: isVisionMode ? (process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview') : GROQ_MODEL,
                messages: messages,
                temperature: 0.6,
                max_tokens: 2048
            },
            {
                headers: {
                    'Authorization': `Bearer ${activeApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        ).catch(err => {
            if (err.response?.status === 413 || err.response?.status === 429) {
                throw new Error('API_LIMIT_REACHED');
            }
            if (err.response?.status === 401) {
                throw new Error('INVALID_API_KEY');
            }
            throw err;
        });

        const rawContent = response.data.choices[0].message.content;
        const hasFormatting = checkFormattingQuality(rawContent);

        // Calculate dynamic confidence score (Rule 7)
        const confidenceResult = calculateConfidence({
            aiConfidence: 85, // Base assumption for 70b-versatile
            hasContext: !!context,
            hasSelectedText: !!selectedText,
            hasVisualContext: !!visualContext,
            isVisionMode,
            responseLength: rawContent.length,
            hasFormatting,
            contentType
        });

        return {
            explanation: rawContent,
            confidence: confidenceResult.finalScore,
            confidenceBreakdown: confidenceResult.breakdown,
            source: isVisionMode ? 'groq_vision' : 'groq_llama'
        };
    } catch (error) {
        console.error('Groq AI call failed:', error.message);
        throw new Error('AI Tutor is currently unavailable.');
    }
};

export const saveDoubtToGraph = async (query, answer, confidence, context = '', contentId = null) => {
    try {
        const queryKey = `${query.toLowerCase().trim()}${context ? '|' + context.toLowerCase().trim() : ''}`;
        await runNeo4jQuery(
            `MERGE(d: Doubt { queryKey: $queryKey })
             SET d.query = $query, d.context = $context, d.answer = $answer,
                 d.confidence = $confidence, d.updatedAt = datetime()
             WITH d
             OPTIONAL MATCH(c: Content { id: $contentId })
             FOREACH(ignoreMe IN CASE WHEN c IS NOT NULL THEN [1] ELSE [] END |
                 MERGE(d)-[:RELATES_TO]->(c)
             )`,
            { queryKey, query: query.trim(), context: context.trim(), answer, confidence, contentId }
        );
    } catch (error) {
        console.error('Error saving doubt to graph:', error);
    }
};

export default {
    searchExistingDoubts,
    askGroq,
    saveDoubtToGraph,
    searchKnowledgeGraph,
    saveToKnowledgeGraph
};
