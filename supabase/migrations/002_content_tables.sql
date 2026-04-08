-- ============================================================
-- MedCore Zambia — Content Tables Migration
-- Run after 001_initial_schema.sql
-- ============================================================

-- ── SUBJECTS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subjects (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,          -- e.g. 'physiology'
  emoji        TEXT NOT NULL DEFAULT '📚',
  description  TEXT,
  color_from   TEXT NOT NULL DEFAULT '#1a4332',
  color_to     TEXT NOT NULL DEFAULT '#0f2a1e',
  chip_class   TEXT NOT NULL DEFAULT 'chip-forest', -- chip-forest/amber/sapp/crim
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Everyone reads active subjects"
  ON public.subjects FOR SELECT USING (is_active = TRUE);
CREATE POLICY "Admins manage subjects"
  ON public.subjects FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ── LESSONS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lessons (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  duration     TEXT NOT NULL DEFAULT '15m',   -- e.g. '14m', '22m'
  body_html    TEXT NOT NULL DEFAULT '',       -- full lesson HTML content
  xp_reward    INTEGER NOT NULL DEFAULT 20,
  is_premium   BOOLEAN NOT NULL DEFAULT TRUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  tags         TEXT[] DEFAULT '{}',            -- e.g. '{high-yield,exam}'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

-- Free users see free lessons; premium/admin see all
CREATE POLICY "Free users read free lessons"
  ON public.lessons FOR SELECT
  USING (is_active = TRUE AND is_premium = FALSE);

CREATE POLICY "Premium users read all lessons"
  ON public.lessons FOR SELECT
  USING (
    is_active = TRUE AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.status = 'active')
    )
  );

CREATE POLICY "Admins manage lessons"
  ON public.lessons FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ── QUIZ QUESTIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_questions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  question     TEXT NOT NULL,
  options      TEXT[] NOT NULL,               -- array of 4 option strings
  correct_idx  INTEGER NOT NULL,              -- 0-based index into options
  explanation  TEXT NOT NULL DEFAULT '',
  difficulty   TEXT NOT NULL DEFAULT 'medium'
                 CHECK (difficulty IN ('easy','medium','hard')),
  tag          TEXT,                          -- display tag e.g. 'PHYSIOLOGY · CARDIAC'
  is_premium   BOOLEAN NOT NULL DEFAULT TRUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.quiz_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Free users read easy free questions"
  ON public.quiz_questions FOR SELECT
  USING (is_active = TRUE AND is_premium = FALSE AND difficulty = 'easy');

CREATE POLICY "Premium users read all questions"
  ON public.quiz_questions FOR SELECT
  USING (
    is_active = TRUE AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.status = 'active')
    )
  );

CREATE POLICY "Admins manage questions"
  ON public.quiz_questions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ── FLASHCARDS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.flashcards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id   UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  question     TEXT NOT NULL,
  answer       TEXT NOT NULL,
  subject_name TEXT,                          -- display label e.g. 'Pharmacology'
  is_premium   BOOLEAN NOT NULL DEFAULT TRUE,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Free users read free flashcards"
  ON public.flashcards FOR SELECT
  USING (is_active = TRUE AND is_premium = FALSE);

CREATE POLICY "Premium users read all flashcards"
  ON public.flashcards FOR SELECT
  USING (
    is_active = TRUE AND
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.role = 'admin' OR p.status = 'active')
    )
  );

CREATE POLICY "Admins manage flashcards"
  ON public.flashcards FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lessons_subject   ON public.lessons(subject_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_lessons_active    ON public.lessons(is_active, is_premium);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON public.quiz_questions(subject_id, difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_active  ON public.quiz_questions(is_active, is_premium);
CREATE INDEX IF NOT EXISTS idx_flashcards_subj   ON public.flashcards(subject_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_subjects_order    ON public.subjects(sort_order, is_active);

-- ── UPDATED_AT TRIGGERS ───────────────────────────────────────
CREATE TRIGGER subjects_updated_at   BEFORE UPDATE ON public.subjects   FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER lessons_updated_at    BEFORE UPDATE ON public.lessons     FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER questions_updated_at  BEFORE UPDATE ON public.quiz_questions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER flashcards_updated_at BEFORE UPDATE ON public.flashcards  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ════════════════════════════════════════════════════════════════
-- SEED DATA — matches the current hardcoded content exactly
-- so the app works immediately after migration
-- ════════════════════════════════════════════════════════════════

-- Subjects
INSERT INTO public.subjects (name, slug, emoji, description, color_from, color_to, chip_class, sort_order) VALUES
  ('Anatomy',          'anatomy',         '🦷', 'Gross anatomy, histology, embryology, and clinical correlations.',          '#1a3a2e','#0d2a1e','chip-forest',0),
  ('Physiology',       'physiology',      '❤️',  'Cardiovascular, renal, respiratory, endocrine, neurophysiology.',          '#0d2a20','#071a13','chip-forest',1),
  ('Biochemistry',     'biochemistry',    '🧬', 'Enzymes, metabolism, genetics, cell signalling.',                           '#1a1a4a','#0d0d2e','chip-sapp',  2),
  ('Pathology',        'pathology',       '🔬', 'Cell injury, inflammation, neoplasia, organ pathology.',                   '#2e1e0a','#1a1005','chip-amber', 3),
  ('Pharmacology',     'pharmacology',    '💊', 'Drug mechanisms, all major classes, adverse effects.',                     '#0a2a2a','#051515','chip-amber', 4),
  ('Microbiology',     'microbiology',    '🦠', 'Bacteriology, virology, mycology, parasitology.',                          '#0d2a0d','#071507','chip-forest',5),
  ('Clinical Medicine','clinical',        '🏥', 'History, examination, diagnostic reasoning, management.',                  '#2a0d0d','#150505','chip-crim',  6)
ON CONFLICT (slug) DO NOTHING;

-- Lessons (all under Physiology — the current hardcoded module)
DO $$
DECLARE physio_id UUID;
BEGIN
  SELECT id INTO physio_id FROM public.subjects WHERE slug = 'physiology';

  INSERT INTO public.lessons (subject_id, title, duration, xp_reward, is_premium, sort_order, tags, body_html) VALUES
  (physio_id,'Cardiac Anatomy Overview','12m',20,FALSE,0,'{cardiovascular}',
'<p>The <strong>heart</strong> is a four-chambered muscular organ located in the mediastinum, slightly left of the midline. Understanding its anatomy is foundational for all of cardiology.</p>
<div class="callout callout-forest"><div class="callout-title">🔑 Key Fact</div>The right side of the heart is a low-pressure pulmonary pump; the left side is a high-pressure systemic pump. This explains why LV walls are thicker (8–12mm vs 3–5mm).</div>
<div class="kp-wrap"><div class="kp-title">Four Chambers</div>
<div class="kp"><div class="kp-dot"></div><div><strong>Right Atrium</strong> — receives deoxygenated blood from SVC, IVC, coronary sinus</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Right Ventricle</strong> — pumps to pulmonary circulation via pulmonary artery</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Left Atrium</strong> — receives oxygenated blood from 4 pulmonary veins</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Left Ventricle</strong> — pumps to systemic circulation; thickest walls</div></div></div>
<div class="callout callout-amber"><div class="callout-title">⚠️ Clinical Correlation</div>Atrial septal defects (ASD) cause left-to-right shunting (higher pressure left → lower pressure right), leading to right heart volume overload and eventually pulmonary hypertension.</div>'),

  (physio_id,'The Cardiac Cycle','18m',20,FALSE,1,'{cardiovascular,high-yield}',
'<p>The <strong>cardiac cycle</strong> describes the sequence of electrical and mechanical events in one complete heartbeat — systole (contraction) and diastole (relaxation).</p>
<div class="callout callout-forest"><div class="callout-title">🔑 Wiggers Diagram</div>Know the relationship between ventricular pressure, aortic pressure, atrial pressure, and ECG. This is one of the most commonly tested topics in physiology exams.</div>
<div class="kp-wrap"><div class="kp-title">Phases of the Cardiac Cycle</div>
<div class="kp"><div class="kp-dot"></div><div><strong>Isovolumetric Contraction</strong> — all valves closed; pressure rises rapidly</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Rapid Ejection</strong> — aortic valve opens; SV is ejected (~70mL at rest)</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Isovolumetric Relaxation</strong> — all valves closed; pressure falls</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Rapid Filling</strong> — mitral valve opens; ~80% of ventricular filling is passive</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Atrial Kick</strong> — active atrial contraction fills final ~20% (lost in atrial fibrillation!)</div></div></div>'),

  (physio_id,'Heart Rate & Rhythm','10m',15,FALSE,2,'{cardiovascular}',
'<p>Heart rate is the number of beats per minute, normally <strong>60–100 bpm</strong> at rest. It is determined by the SA node firing rate, modulated by the autonomic nervous system.</p>
<div class="callout callout-forest"><div class="callout-title">🔑 Autonomic Control</div>Sympathetic (β1): ↑ HR, ↑ contractility. Parasympathetic (vagus, M2): ↓ HR, ↓ AV conduction. At rest, vagal tone predominates — which is why atropine increases HR.</div>
<div class="kp-wrap"><div class="kp-title">Key Definitions</div>
<div class="kp"><div class="kp-dot"></div><div><strong>Sinus Bradycardia</strong> — HR &lt;60 bpm; normal in athletes, beta-blockers, hypothyroidism</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Sinus Tachycardia</strong> — HR &gt;100 bpm; fever, pain, hypovolemia, anxiety</div></div></div>
<div class="callout callout-amber"><div class="callout-title">⚠️ Exam Trap</div>Ivabradine reduces HR by blocking the If (funny) current in the SA node — without affecting blood pressure or contractility.</div>'),

  (physio_id,'Cardiac Action Potentials','15m',25,TRUE,3,'{cardiovascular,high-yield}',
'<p>The <strong>cardiac action potential</strong> coordinates myocardial contraction through five distinct phases — critical for understanding arrhythmias and antiarrhythmic drug classes.</p>
<div class="callout callout-forest"><div class="callout-title">🔑 Clinical Pearl</div>The plateau phase (Phase 2) is pharmacologically targeted by calcium channel blockers and is unique to cardiac and smooth muscle, preventing tetanic contraction.</div>
<div class="kp-wrap"><div class="kp-title">Five Phases</div>
<div class="kp"><div class="kp-dot"></div><div><strong>Phase 0</strong> — Rapid depolarization: fast Na⁺ channels open; −85mV → +20mV</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Phase 1</strong> — Early repolarization: Na⁺ inactivates; Ito K⁺ briefly opens</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Phase 2</strong> — Plateau: L-type Ca²⁺ influx balances K⁺ efflux; prevents tetany</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Phase 3</strong> — Repolarization: IKr/IKs dominates; Ca²⁺ channels close</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Phase 4</strong> — Rest (−85mV ventricular) or pacemaker depolarization (SA/AV)</div></div></div>
<div class="callout callout-amber"><div class="callout-title">⚠️ Classic Exam Trap</div>The long refractory period from Phase 2 is WHY cardiac muscle cannot tetanize — without this, sustained contraction would stop all cardiac output.</div>'),

  (physio_id,'ECG Interpretation','22m',30,TRUE,4,'{cardiovascular,high-yield}',
'<p>The <strong>electrocardiogram (ECG)</strong> records the heart''s electrical activity from the body surface. Mastering ECG interpretation is one of the most clinically essential skills in medicine.</p>
<div class="callout callout-forest"><div class="callout-title">🔑 Systematic Approach</div>Always read ECGs systematically: Rate → Rhythm → Axis → P wave → PR interval → QRS → ST segment → T wave. Never skip steps.</div>
<div class="kp-wrap"><div class="kp-title">ECG Waveforms</div>
<div class="kp"><div class="kp-dot"></div><div><strong>P wave</strong> — atrial depolarization; normal &lt;120ms</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>PR interval</strong> — AV nodal conduction; normal 120–200ms</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>QRS complex</strong> — ventricular depolarization; normal &lt;120ms</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>ST segment</strong> — elevation = injury/STEMI; depression = ischaemia</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>T wave</strong> — ventricular repolarization; inverted in ischaemia</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>QT interval</strong> — QTc &gt;440ms = prolonged (risk of torsades)</div></div></div>'),

  (physio_id,'Starling''s Law','14m',20,TRUE,5,'{cardiovascular}',
'<p>The <strong>Frank-Starling law</strong> states that the heart''s stroke volume increases in response to increased ventricular filling (preload), up to a physiological maximum.</p>
<div class="callout callout-forest"><div class="callout-title">🔑 Mechanism</div>Greater end-diastolic volume → increased sarcomere stretch → more actin-myosin cross-bridges → greater force of contraction → increased stroke volume.</div>
<div class="kp-wrap"><div class="kp-title">Clinical Applications</div>
<div class="kp"><div class="kp-dot"></div><div><strong>IV fluid resuscitation</strong> — increasing preload to boost cardiac output in hypotension</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Heart failure</strong> — the Frank-Starling curve is depressed; same preload → less output</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Exercise</strong> — increased venous return via muscle pump augments stroke volume</div></div></div>
<div class="callout callout-amber"><div class="callout-title">⚠️ Decompensated HF</div>In severe HF, the ventricle operates on the descending limb — more filling actually reduces output. This is why aggressive fluid loading in decompensated HF is harmful.</div>'),

  (physio_id,'Blood Pressure Regulation','16m',20,TRUE,6,'{cardiovascular,high-yield}',
'<p><strong>Blood pressure = Cardiac Output × Total Peripheral Resistance.</strong> Short-term regulation is neural; long-term regulation is renal (RAAS system).</p>
<div class="callout callout-forest"><div class="callout-title">🔑 RAAS Pathway</div>↓ BP → ↓ renal perfusion → juxtaglomerular cells release Renin → Angiotensinogen → Ang I → ACE → Ang II → vasoconstriction + aldosterone → Na⁺/H₂O retention → ↑ BP.</div>
<div class="kp-wrap"><div class="kp-title">Drug Targets in the RAAS</div>
<div class="kp"><div class="kp-dot"></div><div><strong>ACE inhibitors</strong> — block ACE; reduce Ang II and bradykinin degradation (→ cough)</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>ARBs</strong> — block AT1 receptor; no bradykinin effect, so no cough</div></div>
<div class="kp"><div class="kp-dot"></div><div><strong>Spironolactone</strong> — blocks aldosterone receptor; K⁺-sparing diuretic</div></div></div>');
END $$;

-- Quiz questions (seeded from current QDB)
DO $$
DECLARE
  physio_id UUID; pharma_id UUID; micro_id UUID;
  anat_id UUID; biochem_id UUID; path_id UUID;
BEGIN
  SELECT id INTO physio_id FROM public.subjects WHERE slug = 'physiology';
  SELECT id INTO pharma_id FROM public.subjects WHERE slug = 'pharmacology';
  SELECT id INTO micro_id  FROM public.subjects WHERE slug = 'microbiology';
  SELECT id INTO anat_id   FROM public.subjects WHERE slug = 'anatomy';
  SELECT id INTO biochem_id FROM public.subjects WHERE slug = 'biochemistry';
  SELECT id INTO path_id   FROM public.subjects WHERE slug = 'pathology';

  INSERT INTO public.quiz_questions (subject_id,question,options,correct_idx,explanation,difficulty,tag,is_premium,sort_order) VALUES
  (physio_id,'Which ion channel drives the plateau phase (Phase 2) of the cardiac action potential?',
   ARRAY['Voltage-gated Na⁺','L-type Ca²⁺ channels','Delayed rectifier K⁺','Transient K⁺ (Ito)'],1,
   'L-type Ca²⁺ channels create the plateau by balancing K⁺ efflux. This prevents tetanic contraction — unique to cardiac muscle. Target of verapamil, diltiazem, amlodipine.',
   'medium','PHYSIOLOGY · CARDIAC',FALSE,0),

  (pharma_id,'A patient with hypertension AND asthma needs antihypertensive therapy. Which class is CONTRAINDICATED?',
   ARRAY['ACE inhibitors','Dihydropyridine CCBs','Non-selective beta-blockers','Thiazide diuretics'],2,
   'Non-selective β-blockers (propranolol) block β2 receptors in bronchi → bronchoconstriction. Dangerous in asthma/COPD. Cardioselective β1-blockers used with caution. CCBs and ACE-Is are safe alternatives.',
   'hard','PHARMACOLOGY · RESPIRATORY',TRUE,0),

  (micro_id,'Which organism is catalase+, coagulase+, and produces golden pigment?',
   ARRAY['Streptococcus pyogenes','Staphylococcus aureus','S. epidermidis','Enterococcus faecalis'],1,
   'S. aureus: catalase+ (distinguishes from Strep), coagulase+ (distinguishes from other Staph), carotenoid = golden pigment ("aureus"). Causes skin infections, pneumonia, endocarditis, toxic shock.',
   'easy','MICROBIOLOGY · BACTERIA',FALSE,0),

  (anat_id,'The Bundle of His receives impulses from which structure?',
   ARRAY['SA node directly','Bachmann''s bundle','AV node','Purkinje fibers'],2,
   'Conduction path: SA node → AV node (delays 0.12s; allows filling) → Bundle of His → L/R bundle branches → Purkinje fibers → ventricles. The PR interval on ECG reflects AV nodal delay.',
   'easy','ANATOMY · CONDUCTION',FALSE,1),

  (biochem_id,'What enzyme converts pyruvate → lactate during anaerobic glycolysis?',
   ARRAY['Pyruvate dehydrogenase','Pyruvate carboxylase','Lactate dehydrogenase (LDH)','Alanine aminotransferase'],2,
   'LDH: pyruvate + NADH → lactate + NAD⁺. Regenerates NAD⁺ to sustain glycolysis anaerobically. Elevated serum LDH = tissue damage (MI, hemolysis, liver disease).',
   'medium','BIOCHEMISTRY · METABOLISM',TRUE,0),

  (path_id,'Which cell predominates in ACUTE inflammation (e.g., acute appendicitis)?',
   ARRAY['Lymphocytes','Macrophages','Neutrophils (PMNs)','Plasma cells'],2,
   'Neutrophils dominate acute inflammation (0–48h), recruited by IL-8, C5a, LTB4. They phagocytose, release proteases/ROS. After 48h, monocytes → macrophages (chronic).',
   'medium','PATHOLOGY · INFLAMMATION',TRUE,0),

  (pharma_id,'First-line therapy for heart failure with reduced ejection fraction (HFrEF) includes:',
   ARRAY['Thiazide diuretics only','CCBs + digoxin','ACE inhibitor + beta-blocker + loop diuretic','Alpha-1 blocker + nitrates'],2,
   'GDMT for HFrEF: ACE-I/ARB (↓ afterload, prevent remodelling) + carvedilol/metoprolol/bisoprolol (↓ HR) + loop diuretic (↓ preload). Evidence: CONSENSUS, MERIT-HF, RALES.',
   'hard','PHARMACOLOGY · HEART FAILURE',TRUE,1),

  (physio_id,'Furosemide acts on which nephron segment?',
   ARRAY['Proximal tubule','Descending loop','Thick ascending limb','Collecting duct'],2,
   'Furosemide inhibits NKCC2 co-transporter in the thick ascending limb. Disrupts corticomedullary gradient → impairs concentration. Side effects: hypokalemia, hypomagnesemia, hyperuricemia, ototoxicity.',
   'hard','PHYSIOLOGY · RENAL',TRUE,1);
END $$;

-- Flashcards (seeded from current BASE_FC)
DO $$
DECLARE
  pharma_id UUID; physio_id UUID; micro_id UUID; immuno_slug_id UUID;
BEGIN
  SELECT id INTO pharma_id FROM public.subjects WHERE slug = 'pharmacology';
  SELECT id INTO physio_id FROM public.subjects WHERE slug = 'physiology';
  SELECT id INTO micro_id  FROM public.subjects WHERE slug = 'microbiology';

  INSERT INTO public.flashcards (subject_id, subject_name, question, answer, is_premium, sort_order) VALUES
  (pharma_id,'Pharmacology','What is the mechanism of action of beta-blockers?',
   'Beta-blockers competitively antagonize catecholamines at β-adrenergic receptors. β1 → ↓ HR, contractility, BP. β2 → bronchoconstriction. Non-selective: propranolol. Cardioselective: metoprolol, atenolol, bisoprolol.',FALSE,0),

  (NULL,'Immunology','List the 4 types of hypersensitivity reactions.',
   'Type I — IgE-mediated (anaphylaxis). Type II — cytotoxic antibody (hemolytic anemia). Type III — immune complex (SLE, serum sickness). Type IV — delayed T-cell (contact dermatitis, TB test). Mnemonic: ACID.',FALSE,1),

  (physio_id,'Physiology','Which ion channel drives the plateau phase (Phase 2) of cardiac AP?',
   'L-type (long-lasting) Ca²⁺ channels maintain the plateau. Ca²⁺ influx ≈ K⁺ efflux, holding membrane near 0mV. This prevents tetanic contraction and is blocked by verapamil/amlodipine.',FALSE,2),

  (micro_id,'Microbiology','Key differentiators of gram-positive cocci.',
   'S. aureus: catalase+, coagulase+. S. epidermidis: coagulase−. S. pyogenes: beta-hemolytic, ASO. S. pneumoniae: alpha-hemolytic, optochin-sensitive, diplococci. Enterococcus: bile-salt tolerant.',FALSE,3),

  (physio_id,'Physiology','State the Frank-Starling law.',
   '↑ ventricular EDV → ↑ stroke volume (up to physiological limit). Mechanism: more sarcomere stretch → better actin-myosin overlap → greater force. Clinical: fluid loading in hypovolemia; explains decompensated HF.',FALSE,4),

  (pharma_id,'Pharmacology','How do ACE inhibitors lower blood pressure?',
   'Block ACE → ↓ angiotensin I→II conversion → ↓ vasoconstriction + ↓ aldosterone → ↓ SVR, Na⁺ retention. Bradykinin accumulation → dry cough. CI: bilateral RAS, pregnancy.',FALSE,5),

  (physio_id,'Physiology','Describe the renal countercurrent multiplier.',
   'Loop of Henle creates corticomedullary gradient. Descending limb: water-permeable. Ascending limb: water-impermeable, actively pumps Na⁺/K⁺/Cl⁻ (furosemide target). Enables urine concentration to ~1200 mOsm.',FALSE,6),

  (pharma_id,'Pharmacology','Bactericidal vs bacteriostatic antibiotics.',
   'Cidal (kill): β-lactams, aminoglycosides, fluoroquinolones, vancomycin. Static (inhibit growth): tetracyclines, macrolides, clindamycin, sulfonamides. Use cidal in immunocompromised. Never combine — static may antagonize cidal.',FALSE,7);
END $$;
