// api/admin.js — Vercel Serverless Function
// Admin-only API: users, materials, recommendations, and full content CRUD.
// Admin access is gated by ADMIN_EMAILS env var (comma-separated list).

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function setCORSHeaders(res, req) {
  const origin = req.headers.origin || '';
  const appDomain = process.env.APP_DOMAIN || '';
  const ok =
    origin.includes('localhost') ||
    origin.includes('127.0.0.1') ||
    origin.endsWith('.vercel.app') ||
    (appDomain && origin.includes(appDomain));
  const allowOrigin = ok ? origin : (appDomain ? `https://${appDomain}` : '');
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function verifyAdmin(authHeader, supabaseUrl, serviceKey) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const resp = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authHeader, apikey: serviceKey },
    });
    if (!resp.ok) return null;
    const user = await resp.json();
    if (!user?.email) return null;
    if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) return null;
    return user;
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  setCORSHeaders(res, req);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const adminUser = await verifyAdmin(req.headers.authorization, supabaseUrl, serviceKey);
  if (!adminUser) return res.status(403).json({ error: 'Admin access required' });

  const { action } = req.query;
  if (!action) return res.status(400).json({ error: 'action query param required' });

  // ── Supabase REST helper ──────────────────────────────────────────────────
  async function supa(path, method = 'GET', body) {
    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    };
    // Return representation for mutations
    if (['POST', 'PATCH', 'DELETE'].includes(method)) {
      headers['Prefer'] = 'return=representation';
    }
    const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Supabase ${method} ${path} → ${r.status}: ${t}`);
    }
    if (r.status === 204) return [];
    return r.json();
  }

  // ── Input sanitizers ─────────────────────────────────────────────────────
  const s  = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const si = (v) => (Number.isInteger(Number(v)) ? Number(v) : 0);
  const sb = (v) => v === true || v === 'true' || v === 1;

  // ── Notification helper ─────────────────────────────────────────────────
  async function createNotifications(type, title, message, relatedId = null, relatedType = null) {
    // Get all active user IDs
    const users = await supa('profiles?select=id&status=eq.active');
    const notifications = users.map(user => ({
      user_id: user.id,
      type,
      title,
      message,
      related_id: relatedId,
      related_type: relatedType,
    }));
    if (notifications.length > 0) {
      await supa('notifications', 'POST', notifications);
    }
  }

  async function subjectSlugExists(subjectSlug) {
    if (!subjectSlug) return false;
    const safeSubject = s(subjectSlug, 100);
    const data = await supa(`subjects?select=id&slug=eq.${encodeURIComponent(safeSubject)}`);
    return Array.isArray(data) && data.length > 0;
  }

  try {
    switch (action) {

      // ══ USER MANAGEMENT ══════════════════════════════════════════════════
      case 'list_users': {
        const data = await supa('profiles?select=id,email,name,role,status,joined_at&order=joined_at.desc');
        return res.status(200).json({ users: data });
      }
      case 'update_user_status': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { userId, status } = req.body || {};
        if (!userId || !['active', 'pending', 'free'].includes(status)) {
          return res.status(400).json({ error: 'Valid userId and status (active|pending|free) required' });
        }
        if (userId === adminUser.id) {
          return res.status(403).json({ error: 'Cannot modify your own account' });
        }
        await supa(`profiles?id=eq.${userId}`, 'PATCH', { status });
        return res.status(200).json({ ok: true });
      }

      // ══ MATERIALS ════════════════════════════════════════════════════════
      case 'list_materials': {
        const data = await supa('materials?select=*&order=created_at.desc');
        return res.status(200).json({ materials: data });
      }
      case 'add_material': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { title, subject, type, content_url, description, premium } = req.body || {};
        if (!title || !subject || !type) {
          return res.status(400).json({ error: 'title, subject, and type are required' });
        }
        if (!await subjectSlugExists(subject)) {
          return res.status(400).json({ error: 'Subject not found; choose an existing subject or create it first' });
        }
        const mat = await supa('materials', 'POST', {
          title:       s(title, 200),
          subject:     s(subject, 100),
          type:        s(type, 50),
          content_url: s(content_url, 1000) || null,
          description: s(description, 1000) || null,
          premium:     premium !== false,
          created_by:  adminUser.id,
        });
        // Create notifications for new material
        await createNotifications(
          'new_material',
          'New Study Material Available',
          `Check out the new ${type} material: "${title}" in ${subject}`,
          mat[0]?.id || mat.id,
          'material'
        );
        return res.status(201).json({ material: mat[0] || mat });
      }
      case 'delete_material': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { materialId } = req.body || {};
        if (!materialId) return res.status(400).json({ error: 'materialId required' });
        await supa(`materials?id=eq.${materialId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      // ══ LESSON SECTIONS ══════════════════════════════════════════════════
      case 'list_lesson_sections': {
        const { lessonId } = req.body || req.query || {};
        if (!lessonId) return res.status(400).json({ error: 'lessonId required' });
        const data = await supa(`lesson_sections?lesson_id=eq.${lessonId}&order=sort_order.asc`);
        return res.status(200).json({ sections: data });
      }
      case 'add_lesson_section': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { lesson_id, section_type, title, content, sort_order } = req.body || {};
        if (!lesson_id || !section_type || !content) {
          return res.status(400).json({ error: 'lesson_id, section_type, and content required' });
        }
        if (!['key_fact','section','intro'].includes(section_type)) {
          return res.status(400).json({ error: 'Invalid section_type' });
        }
        const sec = await supa('lesson_sections', 'POST', {
          lesson_id:    s(lesson_id, 50),
          section_type: s(section_type, 20),
          title:        (section_type !== 'key_fact' && title) ? s(title, 200) : null,
          content:      s(content, 5000),
          sort_order:   si(sort_order || 0),
        });
        return res.status(201).json({ section: sec[0] || sec });
      }
      case 'update_lesson_section': {
        if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH required' });
        const { sectionId, title, content, sort_order } = req.body || {};
        if (!sectionId) return res.status(400).json({ error: 'sectionId required' });
        const patch = {};
        if (title !== undefined) patch.title = s(title, 200);
        if (content !== undefined) patch.content = s(content, 5000);
        if (sort_order !== undefined) patch.sort_order = si(sort_order);
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No fields to update' });
        await supa(`lesson_sections?id=eq.${sectionId}`, 'PATCH', patch);
        return res.status(200).json({ ok: true });
      }
      case 'delete_lesson_section': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { sectionId } = req.body || {};
        if (!sectionId) return res.status(400).json({ error: 'sectionId required' });
        await supa(`lesson_sections?id=eq.${sectionId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      // ══ RECOMMENDATIONS ══════════════════════════════════════════════════
      case 'list_recommendations': {
        const data = await supa('recommendations?select=*&order=created_at.desc');
        return res.status(200).json({ recommendations: data });
      }
      case 'add_recommendation': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { title, description, subject, link } = req.body || {};
        if (!title) return res.status(400).json({ error: 'title required' });
        if (subject && !await subjectSlugExists(subject)) {
          return res.status(400).json({ error: 'Subject is not allowed; choose a valid core discipline' });
        }
        const rec = await supa('recommendations', 'POST', {
          title:       s(title, 200),
          description: s(description, 2000) || null,
          subject:     s(subject, 100) || null,
          link:        s(link, 500) || null,
          created_by:  adminUser.id,
        });
        // Create notifications for new recommendation
        await createNotifications(
          'recommendation',
          'New Recommendation Added',
          `Check out this new recommendation: "${title}"`,
          rec[0]?.id || rec.id,
          'recommendation'
        );
        return res.status(201).json({ recommendation: rec[0] || rec });
      }
      case 'delete_recommendation': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { recId } = req.body || {};
        if (!recId) return res.status(400).json({ error: 'recId required' });
        await supa(`recommendations?id=eq.${recId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      // ══ SUBJECTS ═════════════════════════════════════════════════════════
      case 'list_subjects': {
        const data = await supa('subjects?select=*&order=sort_order.asc');
        return res.status(200).json({ subjects: data });
      }
      case 'add_subject': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { name, slug, emoji, description, color_from, color_to, chip_class, sort_order } = req.body || {};
        if (!name || !slug) return res.status(400).json({ error: 'name and slug required' });
        const data = await supa('subjects', 'POST', {
          name:       s(name, 100),
          slug:       s(slug, 100).toLowerCase().replace(/\s+/g, '-'),
          emoji:      s(emoji, 10) || '📚',
          description:s(description, 500) || null,
          color_from: s(color_from, 20) || '#1a4332',
          color_to:   s(color_to, 20) || '#0f2a1e',
          chip_class: s(chip_class, 30) || 'chip-forest',
          sort_order: si(sort_order),
        });
        return res.status(201).json({ subject: data[0] || data });
      }
      case 'update_subject': {
        if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH required' });
        const { subjectId, ...fields } = req.body || {};
        if (!subjectId) return res.status(400).json({ error: 'subjectId required' });
        const allowed = ['name','emoji','description','color_from','color_to','chip_class','sort_order','is_active'];
        const patch = {};
        for (const k of allowed) if (fields[k] !== undefined) patch[k] = fields[k];
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
        await supa(`subjects?id=eq.${subjectId}`, 'PATCH', patch);
        return res.status(200).json({ ok: true });
      }
      case 'delete_subject': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { subjectId } = req.body || {};
        if (!subjectId) return res.status(400).json({ error: 'subjectId required' });
        await supa(`subjects?id=eq.${subjectId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      // ══ LESSONS ══════════════════════════════════════════════════════════
      case 'list_lessons': {
        const { subjectId } = req.query;
        const filter = subjectId ? `&subject_id=eq.${subjectId}` : '';
        const data = await supa(
          `lessons?select=id,subject_id,title,duration,xp_reward,is_premium,is_active,sort_order,tags,subjects(name)${filter}&order=sort_order.asc`
        );
        return res.status(200).json({ lessons: data });
      }
      case 'add_lesson': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { subject_id, title, duration, body_html, xp_reward, is_premium, sort_order, tags } = req.body || {};
        if (!subject_id || !title) {
          return res.status(400).json({ error: 'subject_id and title required' });
        }
        const data = await supa('lessons', 'POST', {
          subject_id,
          title:      s(title, 200),
          duration:   s(duration, 20) || '15m',
          body_html:  (typeof body_html === 'string' ? body_html : '').slice(0, 50000),
          xp_reward:  si(xp_reward) || 20,
          is_premium: sb(is_premium),
          sort_order: si(sort_order),
          tags:       Array.isArray(tags) ? tags.map(t => s(t, 50)) : [],
        });
        // Create notifications for new lesson
        await createNotifications(
          'new_lesson',
          'New Lesson Published',
          `A new lesson is now available: "${s(title)}"`,
          data[0]?.id || data.id,
          'lesson'
        );
        return res.status(201).json({ lesson: data[0] || data });
      }
      case 'update_lesson': {
        if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH required' });
        const { lessonId, ...fields } = req.body || {};
        if (!lessonId) return res.status(400).json({ error: 'lessonId required' });
        const allowed = ['title','duration','body_html','xp_reward','is_premium','is_active','sort_order','tags'];
        const patch = {};
        for (const k of allowed) if (fields[k] !== undefined) patch[k] = fields[k];
        if (patch.body_html) patch.body_html = patch.body_html.slice(0, 50000);
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
        await supa(`lessons?id=eq.${lessonId}`, 'PATCH', patch);
        return res.status(200).json({ ok: true });
      }
      case 'delete_lesson': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { lessonId } = req.body || {};
        if (!lessonId) return res.status(400).json({ error: 'lessonId required' });
        await supa(`lessons?id=eq.${lessonId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      // ══ QUIZ QUESTIONS ═══════════════════════════════════════════════════
      case 'list_questions': {
        const { subjectId } = req.query;
        const filter = subjectId ? `&subject_id=eq.${subjectId}` : '';
        const data = await supa(
          `quiz_questions?select=*,subjects(name)${filter}&order=subject_id.asc,sort_order.asc`
        );
        return res.status(200).json({ questions: data });
      }
      case 'add_question': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { subject_id, question, options, correct_idx, explanation, difficulty, tag, is_premium, sort_order } = req.body || {};
        if (!subject_id || !question || !Array.isArray(options) || options.length < 2) {
          return res.status(400).json({ error: 'subject_id, question, and options[] (min 2) required' });
        }
        const cidx = si(correct_idx);
        if (cidx < 0 || cidx >= options.length) {
          return res.status(400).json({ error: 'correct_idx out of range' });
        }
        const data = await supa('quiz_questions', 'POST', {
          subject_id,
          question:    s(question, 1000),
          options:     options.map(o => s(o, 300)),
          correct_idx: cidx,
          explanation: s(explanation, 2000),
          difficulty:  ['easy','medium','hard'].includes(difficulty) ? difficulty : 'medium',
          tag:         s(tag, 100) || null,
          is_premium:  sb(is_premium),
          sort_order:  si(sort_order),
        });
        // Create notifications for new quiz/question
        await createNotifications(
          'new_quiz',
          'New Quiz Question Added',
          `New quiz question added: "${s(question, 50)}"`,
          data[0]?.id || data.id,
          'quiz'
        );
        return res.status(201).json({ question: data[0] || data });
      }
      case 'update_question': {
        if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH required' });
        const { questionId, ...fields } = req.body || {};
        if (!questionId) return res.status(400).json({ error: 'questionId required' });
        const allowed = ['question','options','correct_idx','explanation','difficulty','tag','is_premium','is_active','sort_order'];
        const patch = {};
        for (const k of allowed) if (fields[k] !== undefined) patch[k] = fields[k];
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
        await supa(`quiz_questions?id=eq.${questionId}`, 'PATCH', patch);
        return res.status(200).json({ ok: true });
      }
      case 'delete_question': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { questionId } = req.body || {};
        if (!questionId) return res.status(400).json({ error: 'questionId required' });
        await supa(`quiz_questions?id=eq.${questionId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      // ══ FLASHCARDS ═══════════════════════════════════════════════════════
      case 'list_flashcards': {
        const { subjectId } = req.query;
        const filter = subjectId ? `&subject_id=eq.${subjectId}` : '';
        const data = await supa(`flashcards?select=*${filter}&order=sort_order.asc`);
        return res.status(200).json({ flashcards: data });
      }
      case 'add_flashcard': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
        const { subject_id, subject_name, question, answer, is_premium, sort_order } = req.body || {};
        if (!question || !answer) {
          return res.status(400).json({ error: 'question and answer required' });
        }
        const data = await supa('flashcards', 'POST', {
          subject_id:   subject_id || null,
          subject_name: s(subject_name, 100) || null,
          question:     s(question, 1000),
          answer:       s(answer, 2000),
          is_premium:   sb(is_premium),
          sort_order:   si(sort_order),
        });
        return res.status(201).json({ flashcard: data[0] || data });
      }
      case 'update_flashcard': {
        if (req.method !== 'PATCH') return res.status(405).json({ error: 'PATCH required' });
        const { flashcardId, ...fields } = req.body || {};
        if (!flashcardId) return res.status(400).json({ error: 'flashcardId required' });
        const allowed = ['question','answer','subject_name','is_premium','is_active','sort_order'];
        const patch = {};
        for (const k of allowed) if (fields[k] !== undefined) patch[k] = fields[k];
        if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });
        await supa(`flashcards?id=eq.${flashcardId}`, 'PATCH', patch);
        return res.status(200).json({ ok: true });
      }
      case 'delete_flashcard': {
        if (req.method !== 'DELETE') return res.status(405).json({ error: 'DELETE required' });
        const { flashcardId } = req.body || {};
        if (!flashcardId) return res.status(400).json({ error: 'flashcardId required' });
        await supa(`flashcards?id=eq.${flashcardId}`, 'DELETE');
        return res.status(200).json({ ok: true });
      }

      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[admin]', action, err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
};
