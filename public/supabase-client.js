// supabase-client.js
// Thin wrapper around the Supabase JS SDK (loaded via CDN in HTML).
// Provides auth, progress sync, and admin helpers.
// Expects window.MEDCORE_CONFIG = { supabaseUrl, supabaseAnonKey }

(function (global) {
  'use strict';

  // ── Bootstrap ────────────────────────────────────────────
  function getSupabase() {
    if (!global.supabase) throw new Error('Supabase SDK not loaded');
    const { supabaseUrl, supabaseAnonKey } = global.MEDCORE_CONFIG || {};
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('MEDCORE_CONFIG missing supabaseUrl or supabaseAnonKey');
    }
   return global.supabase.createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: window.localStorage,
        flowType: 'implicit',
      },
    });
  }

  let _client = null;
  function client() {
    if (!_client) _client = getSupabase();
    return _client;
  }

  // Force token refresh on load
  setTimeout(async () => {
    try {
      await client().auth.refreshSession();
    } catch(e) {}
  }, 1000);

  // ── AUTH ─────────────────────────────────────────────────

  /**
   * Sign in with Google (opens OAuth redirect).
   */
  async function signInWithGoogle() {
    const { error } = await client().auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/medcore-v3.html',
        queryParams: { prompt: 'select_account' },
      },
    });
    if (error) throw error;
  }

  /** Sign out from Supabase */
  async function signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
  }

  /** Get current session. Returns null if not authenticated. */
  async function getSession() {
    const { data: { session }, error } = await client().auth.getSession();
    if (error) return null;
    return session;
  }

  /** Get current user. Returns null if not authenticated. */
  async function getUser() {
    const { data: { user }, error } = await client().auth.getUser();
    if (error) return null;
    return user;
  }

  /**
   * Listen for auth state changes.
   * Callback receives (event, session).
   */
  function onAuthStateChange(callback) {
    const { data: { subscription } } = client().auth.onAuthStateChange(callback);
    return subscription;
  }

  /** Get the current JWT (for API calls). */
  async function getAccessToken() {
    const session = await getSession();
    return session?.access_token || null;
  }

  // ── PROFILE ───────────────────────────────────────────────

  /** Fetch the profile row for the current user */
  async function getProfile(userId) {
    const { data, error } = await client()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    if (error) throw error;
    return data;
  }

  /** Check if user is admin */
  async function checkIsAdmin(userId) {
    try {
      const profile = await getProfile(userId);
      return profile?.role === 'admin';
    } catch {
      return false;
    }
  }

  /** Check if user has premium (active) access */
  async function checkIsPremium(userId) {
    try {
      const profile = await getProfile(userId);
      return profile?.role === 'admin' || profile?.status === 'active';
    } catch {
      return false;
    }
  }

  // ── USER PROGRESS ────────────────────────────────────────

  /** Load progress row (creates one if missing) */
  async function loadProgress(userId) {
    let { data, error } = await client()
      .from('user_progress')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code === 'PGRST116') {
      // Row not found — insert defaults
      const defaults = {
        user_id: userId,
        xp: 0, streak: 0, best_streak: 0,
        card_reviews: 0, ai_questions: 0, lessons_done: 0,
        last_study_date: null,
        subject_progress: {
          anatomy:0, physiology:0, biochemistry:0,
          pathology:0, pharmacology:0, microbiology:0, clinical:0,
        },
        quiz_history: [],
        flashcards: null,
        settings: {},
      };
      const { data: inserted, error: insertErr } = await client()
        .from('user_progress')
       .upsert(defaults, { onConflict: 'user_id' })
        .select()
        .single();
      if (insertErr) throw insertErr;
      return inserted;
    }
    if (error) throw error;
    return data;
  }

  /** Save (upsert) progress row */
  async function saveProgress(userId, updates) {
    const { error } = await client()
      .from('user_progress')
      .upsert({ user_id: userId, ...updates, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw error;
  }

  // ── COMPLETED LESSONS ────────────────────────────────────

  /** Get set of completed lesson IDs for a user */
  async function getCompletedLessons(userId) {
    const { data, error } = await client()
      .from('completed_lessons')
      .select('lesson_id')
      .eq('user_id', userId);
    if (error) throw error;
    return new Set((data || []).map(r => r.lesson_id));
  }

  /** Mark a lesson as complete */
  async function completeLesson(userId, lessonId) {
    const { error } = await client()
      .from('completed_lessons')
      .upsert({ user_id: userId, lesson_id: lessonId });
    if (error) throw error;
  }

  // ── MATERIALS ────────────────────────────────────────────

  /** Load materials */
  async function getMaterials(subject) {
    let query = client().from('materials').select('*').order('created_at', { ascending: false });
    if (subject) query = query.eq('subject', subject);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // ── RECOMMENDATIONS ──────────────────────────────────────

  async function getRecommendations() {
    const { data, error } = await client()
      .from('recommendations')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // ── AI PROXY ─────────────────────────────────────────────

  /**
   * Send a message to the Claude AI proxy endpoint.
   * Uses the current session token — never exposes the Anthropic key.
   */
  async function askAI(messages, systemPrompt) {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const resp = await fetch('/api/ai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages, system: systemPrompt }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `AI error ${resp.status}`);
    }
    return resp.json();
  }

  // ── ADMIN HELPERS ─────────────────────────────────────────

  async function adminCall(action, method = 'GET', body) {
    const token = await getAccessToken();
    if (!token) throw new Error('Not authenticated');

    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(`/api/admin?action=${action}`, opts);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `Admin API error ${resp.status}`);
    }
    return resp.json();
  }

  const admin = {
    listUsers:              ()               => adminCall('list_users'),
    updateUserStatus:       (userId, status) => adminCall('update_user_status', 'POST', { userId, status }),
    listMaterials:          ()               => adminCall('list_materials'),
    addMaterial:            (mat)            => adminCall('add_material', 'POST', mat),
    deleteMaterial:         (materialId)     => adminCall('delete_material', 'DELETE', { materialId }),
    listLessonSections:     (lessonId)       => adminCall('list_lesson_sections', 'POST', { lessonId }),
    addLessonSection:       (sec)            => adminCall('add_lesson_section', 'POST', sec),
    updateLessonSection:    (sec)            => adminCall('update_lesson_section', 'PATCH', sec),
    deleteLessonSection:    (sectionId)      => adminCall('delete_lesson_section', 'DELETE', { sectionId }),
    listRecommendations:    ()               => adminCall('list_recommendations'),
    addRecommendation:      (rec)            => adminCall('add_recommendation', 'POST', rec),
    deleteRecommendation:   (recId)          => adminCall('delete_recommendation', 'DELETE', { recId }),
  };

  // ── FILE STORAGE ─────────────────────────────────────────

  /**
   * Upload a material file to Supabase Storage.
   * @param {File} file - The file object to upload
   * @param {string} subject - Subject slug for organizing files
   * @returns {Promise<string>} Public signed URL of the uploaded file
   */
  async function uploadMaterialFile(file, subject) {
    if (!file) throw new Error('No file provided');
    if (!subject) throw new Error('No subject provided');

    // Sanitize filename
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^\w\s\-.()\[\]]/g, '_').replace(/\s+/g, '_');
    const storagePath = `${subject}/${timestamp}_${safeName}`;

    console.log('[uploadMaterialFile] Starting upload:', { storagePath, fileSize: file.size, fileType: file.type });

    // Upload to 'materials' bucket
    const { data, error } = await client().storage
      .from('materials')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('[uploadMaterialFile] Upload error:', error);
      throw new Error(`Upload failed: ${error.message}`);
    }
    if (!data) {
      console.error('[uploadMaterialFile] Upload returned no data');
      throw new Error('Upload returned no data');
    }

    console.log('[uploadMaterialFile] Upload successful:', data.path);

    // Get a signed URL (valid for 1 year)
    const { data: signedUrlData, error: urlError } = await client().storage
      .from('materials')
      .createSignedUrl(data.path, 60 * 60 * 24 * 365); // 1 year

    if (urlError) {
      console.error('[uploadMaterialFile] Signed URL error:', urlError);
      throw new Error(`Failed to generate signed URL: ${urlError.message}`);
    }
    if (!signedUrlData) {
      console.error('[uploadMaterialFile] Signed URL returned no data');
      throw new Error('Failed to generate signed URL');
    }

    console.log('[uploadMaterialFile] Signed URL generated successfully');
    return signedUrlData.signedUrl;
  }

  // ── CONTENT (read by students, RLS enforces access) ──────

  async function getSubjects() {
    const { data, error } = await client()
      .from('subjects').select('*').eq('is_active', true).order('sort_order');
    if (error) throw error;
    return data || [];
  }

  async function getLessons(subjectId) {
    let q = client().from('lessons')
      .select('id,subject_id,title,duration,xp_reward,is_premium,sort_order,tags,body_html')
      .eq('is_active', true).order('sort_order');
    if (subjectId) q = q.eq('subject_id', subjectId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function getQuizQuestions(subjectId) {
    let q = client().from('quiz_questions')
      .select('id,subject_id,question,options,correct_idx,explanation,difficulty,tag,is_premium')
      .eq('is_active', true).order('sort_order');
    if (subjectId) q = q.eq('subject_id', subjectId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function getFlashcards(subjectId) {
    let q = client().from('flashcards')
      .select('id,subject_id,subject_name,question,answer,is_premium,sort_order')
      .eq('is_active', true).order('sort_order');
    if (subjectId) q = q.eq('subject_id', subjectId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  // ── NOTIFICATIONS ─────────────────────────────────────────

  async function getNotifications(userId) {
    const { data, error } = await client()
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function markNotificationAsRead(notificationId) {
    const { error } = await client()
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);
    if (error) throw error;
  }

  // ── Admin content helpers (proxied via API) ────────────────

  function adminContentCall(action, method = 'GET', body, extraParams = '') {
    return adminCall(`${action}${extraParams}`, method, body);
  }

  const adminContent = {
    listSubjects:    ()    => adminContentCall('list_subjects'),
    addSubject:      (d)   => adminContentCall('add_subject',    'POST',   d),
    updateSubject:   (d)   => adminContentCall('update_subject', 'PATCH',  d),
    deleteSubject:   (id)  => adminContentCall('delete_subject', 'DELETE', { subjectId: id }),

    listLessons:     (sid) => adminContentCall('list_lessons',    'GET',   null, sid ? `&subjectId=${sid}` : ''),
    addLesson:       (d)   => adminContentCall('add_lesson',     'POST',   d),
    updateLesson:    (d)   => adminContentCall('update_lesson',  'PATCH',  d),
    deleteLesson:    (id)  => adminContentCall('delete_lesson',  'DELETE', { lessonId: id }),

    listQuestions:   (sid) => adminContentCall('list_questions',  'GET',   null, sid ? `&subjectId=${sid}` : ''),
    addQuestion:     (d)   => adminContentCall('add_question',   'POST',   d),
    updateQuestion:  (d)   => adminContentCall('update_question','PATCH',  d),
    deleteQuestion:  (id)  => adminContentCall('delete_question','DELETE', { questionId: id }),

    listFlashcards:  (sid) => adminContentCall('list_flashcards', 'GET',   null, sid ? `&subjectId=${sid}` : ''),
    addFlashcard:    (d)   => adminContentCall('add_flashcard',  'POST',   d),
    updateFlashcard: (d)   => adminContentCall('update_flashcard','PATCH', d),
    deleteFlashcard: (id)  => adminContentCall('delete_flashcard','DELETE',{ flashcardId: id }),
  };
  // Expose raw client for leaderboard queries
  global._supabaseClient = client();
  // ── Public API ────────────────────────────────────────────
  global.MedcoreDB = {
    // Auth
    signInWithGoogle, signOut, getSession, getUser, getAccessToken, onAuthStateChange,
    // Profile
    getProfile, checkIsAdmin, checkIsPremium,
    // Progress
    loadProgress, saveProgress,
    // Completed lessons
    getCompletedLessons, completeLesson,
    // Materials / Recommendations
    getMaterials, getRecommendations,
    // Content
    getSubjects, getLessons, getQuizQuestions, getFlashcards,
    // Notifications
    getNotifications, markNotificationAsRead,
    // Storage
    uploadMaterialFile,
    // AI
    askAI,
    // Admin (users + content merged)
    admin: { ...admin, ...adminContent },
  };

})(window);
