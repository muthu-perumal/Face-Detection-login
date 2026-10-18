-- Attendance schema for Neon PostgreSQL.
-- Authorization is enforced by row level security after the request sets app.user_id and app.role,
-- then switches to the non-owner app_user role. Biometric ciphertext is not included in admin views.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles r ON r.oid = m.roleid
    JOIN pg_roles u ON u.oid = m.member
    WHERE r.rolname = 'app_user' AND u.rolname = current_user
  ) THEN
    EXECUTE format('GRANT app_user TO %I', current_user);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_profile() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id = gen_random_uuid();
  END IF;
  NEW.auth_user_id = NEW.id;
  NEW.email = lower(NEW.email);
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.role', true) IS DISTINCT FROM 'system' THEN
      NEW.role = 'employee';
    END IF;
    IF NEW.role NOT IN ('employee', 'admin') THEN
      NEW.role = 'employee';
    END IF;
  ELSE
    IF current_setting('app.role', true) NOT IN ('admin', 'system') THEN
      NEW.role = OLD.role;
      NEW.status = OLD.status;
      NEW.employee_id = OLD.employee_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION protect_attendance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'admin' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.clock_in_at IS NOT NULL THEN
        NEW.clock_in_at = now();
      END IF;
      NEW.clock_out_at = NULL;
    ELSE
      NEW.employee_id = OLD.employee_id;
      NEW.attendance_date = OLD.attendance_date;
      NEW.session_index = OLD.session_index;
      NEW.status = OLD.status;
      NEW.verification_method = OLD.verification_method;
      IF NEW.clock_in_at IS DISTINCT FROM OLD.clock_in_at THEN
        NEW.clock_in_at = COALESCE(OLD.clock_in_at, now());
      END IF;
      IF NEW.clock_out_at IS DISTINCT FROM OLD.clock_out_at THEN
        NEW.clock_out_at = CASE WHEN OLD.clock_out_at IS NULL THEN now() ELSE OLD.clock_out_at END;
      END IF;
    END IF;
  END IF;

  IF NEW.clock_in_at IS NOT NULL AND NEW.clock_out_at IS NOT NULL THEN
    NEW.total_minutes = FLOOR(EXTRACT(EPOCH FROM (NEW.clock_out_at - NEW.clock_in_at)) / 60)::int;
  ELSE
    NEW.total_minutes = NULL;
  END IF;

  IF NEW.total_minutes IS NOT NULL AND NEW.total_minutes < 0 THEN
    RAISE EXCEPTION 'clock out is earlier than clock in';
  END IF;
  RETURN NEW;
END $$;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  employee_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL,
  designation TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'suspended')),
  password_hash TEXT NOT NULL,
  avatar_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS face_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  encrypted_template TEXT NOT NULL,
  template_version TEXT NOT NULL,
  model_version TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consent_version TEXT NOT NULL,
  consent_timestamp TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  UNIQUE (employee_id)
);

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  clock_in_at TIMESTAMPTZ,
  clock_out_at TIMESTAMPTZ,
  total_minutes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'incomplete', 'pending_review')),
  verification_method TEXT NOT NULL CHECK (verification_method IN ('face', 'manual', 'admin')),
  session_index INTEGER NOT NULL DEFAULT 1 CHECK (session_index >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, attendance_date, session_index),
  CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at)
);

CREATE TABLE IF NOT EXISTS attendance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id UUID REFERENCES attendance(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attendance_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  working_days INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5],
  work_start_time TIME NOT NULL DEFAULT '09:00',
  work_end_time TIME NOT NULL DEFAULT '18:00',
  grace_period_minutes INTEGER NOT NULL DEFAULT 15 CHECK (grace_period_minutes BETWEEN 0 AND 180),
  late_threshold_minutes INTEGER NOT NULL DEFAULT 15 CHECK (late_threshold_minutes BETWEEN 0 AND 180),
  face_distance_threshold NUMERIC NOT NULL DEFAULT 0.50 CHECK (face_distance_threshold BETWEEN 0.2 AND 1.2),
  allow_manual_attendance BOOLEAN NOT NULL DEFAULT true,
  require_face_verification BOOLEAN NOT NULL DEFAULT true,
  require_admin_approval BOOLEAN NOT NULL DEFAULT false,
  face_reenroll_policy TEXT NOT NULL DEFAULT 'self_service' CHECK (face_reenroll_policy IN ('self_service', 'admin_only', 'disabled')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  success BOOLEAN NOT NULL,
  reason TEXT,
  distance NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL CHECK (instruction IN ('turn_left', 'turn_right', 'nod')),
  nonce TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  attendance_date DATE NOT NULL,
  requested_action TEXT NOT NULL CHECK (requested_action IN ('clock_in', 'clock_out')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id UUID REFERENCES profiles(id),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_employee_date_idx ON attendance (employee_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON attendance (attendance_date);
CREATE INDEX IF NOT EXISTS attendance_events_employee_idx ON attendance_events (employee_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS verification_attempts_employee_idx ON verification_attempts (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts (email, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_review
  ON manual_reviews (employee_id, attendance_date, requested_action)
  WHERE status = 'pending';

DROP TRIGGER IF EXISTS profiles_protect ON profiles;
CREATE TRIGGER profiles_protect BEFORE INSERT OR UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION protect_profile();

DROP TRIGGER IF EXISTS profiles_updated ON profiles;
CREATE TRIGGER profiles_updated BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS attendance_protect ON attendance;
CREATE TRIGGER attendance_protect BEFORE INSERT OR UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION protect_attendance();

DROP TRIGGER IF EXISTS attendance_updated ON attendance;
CREATE TRIGGER attendance_updated BEFORE UPDATE ON attendance
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS face_updated ON face_enrollments;
CREATE TRIGGER face_updated BEFORE UPDATE ON face_enrollments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS settings_updated ON attendance_settings;
CREATE TRIGGER settings_updated BEFORE UPDATE ON attendance_settings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

INSERT INTO attendance_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION list_enrollment_status()
RETURNS TABLE (employee_id uuid, status text, enrolled_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.role', true) NOT IN ('admin', 'system') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
    SELECT f.employee_id, f.status, f.enrolled_at, f.updated_at
    FROM public.face_enrollments f
    WHERE f.status = 'active';
END $$;

CREATE OR REPLACE FUNCTION lookup_login(p_email text)
RETURNS TABLE (
  id uuid,
  password_hash text,
  role text,
  status text,
  email text,
  full_name text,
  employee_id text,
  department text,
  designation text,
  avatar_data text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'system' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
    SELECT p.id, p.password_hash, p.role, p.status, p.email, p.full_name, p.employee_id, p.department, p.designation, p.avatar_data
    FROM public.profiles p
    WHERE p.email = lower(p_email);
END $$;

CREATE OR REPLACE FUNCTION read_password_hash(target uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.role', true) IS DISTINCT FROM 'system'
     AND target::text IS DISTINCT FROM current_setting('app.user_id', true) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN (SELECT p.password_hash FROM public.profiles p WHERE p.id = target);
END $$;

CREATE OR REPLACE FUNCTION read_own_template(target uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.role', true) = 'admin' THEN
    RAISE EXCEPTION 'Administrators cannot read biometric templates';
  END IF;
  IF target::text IS DISTINCT FROM current_setting('app.user_id', true) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN (
    SELECT f.encrypted_template
    FROM public.face_enrollments f
    WHERE f.employee_id = target AND f.status = 'active'
  );
END $$;

REVOKE ALL ON FUNCTION list_enrollment_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION lookup_login(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_password_hash(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION read_own_template(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_enrollment_status() TO app_user;
GRANT EXECUTE ON FUNCTION lookup_login(text) TO app_user;
GRANT EXECUTE ON FUNCTION read_password_hash(uuid) TO app_user;
GRANT EXECUTE ON FUNCTION read_own_template(uuid) TO app_user;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
REVOKE SELECT (password_hash) ON profiles FROM app_user;
REVOKE SELECT (encrypted_template) ON face_enrollments FROM app_user;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE face_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR id::text = current_setting('app.user_id', true)
  );
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT
  WITH CHECK (current_setting('app.role', true) = 'system');
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS sessions_all ON sessions;
CREATE POLICY sessions_all ON sessions FOR ALL
  USING (
    current_setting('app.role', true) = 'system'
    OR user_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.role', true) = 'system'
    OR user_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS face_select ON face_enrollments;
CREATE POLICY face_select ON face_enrollments FOR SELECT
  USING (
    current_setting('app.role', true) = 'system'
    OR employee_id::text = current_setting('app.user_id', true)
  );
DROP POLICY IF EXISTS face_insert ON face_enrollments;
CREATE POLICY face_insert ON face_enrollments FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) = 'system'
    OR employee_id::text = current_setting('app.user_id', true)
  );
DROP POLICY IF EXISTS face_update ON face_enrollments;
CREATE POLICY face_update ON face_enrollments FOR UPDATE
  USING (
    current_setting('app.role', true) = 'system'
    OR employee_id::text = current_setting('app.user_id', true)
  );
DROP POLICY IF EXISTS face_delete ON face_enrollments;
CREATE POLICY face_delete ON face_enrollments FOR DELETE
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS attendance_owner ON attendance;
CREATE POLICY attendance_owner ON attendance FOR ALL
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS events_owner ON attendance_events;
CREATE POLICY events_owner ON attendance_events FOR ALL
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS settings_read ON attendance_settings;
CREATE POLICY settings_read ON attendance_settings FOR SELECT
  USING (current_setting('app.role', true) IN ('system', 'admin', 'employee'));
DROP POLICY IF EXISTS settings_write ON attendance_settings;
CREATE POLICY settings_write ON attendance_settings FOR UPDATE
  USING (current_setting('app.role', true) = 'admin')
  WITH CHECK (current_setting('app.role', true) = 'admin');

DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK (
    current_setting('app.role', true) IN ('system', 'admin')
    OR actor_id::text = current_setting('app.user_id', true)
  );
DROP POLICY IF EXISTS audit_select ON audit_logs;
CREATE POLICY audit_select ON audit_logs FOR SELECT
  USING (current_setting('app.role', true) IN ('system', 'admin'));

DROP POLICY IF EXISTS attempts_owner ON verification_attempts;
CREATE POLICY attempts_owner ON verification_attempts FOR ALL
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS challenges_owner ON verification_challenges;
CREATE POLICY challenges_owner ON verification_challenges FOR ALL
  USING (
    current_setting('app.role', true) = 'system'
    OR employee_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.role', true) = 'system'
    OR employee_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS reviews_owner ON manual_reviews;
CREATE POLICY reviews_owner ON manual_reviews FOR ALL
  USING (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  )
  WITH CHECK (
    current_setting('app.role', true) IN ('system', 'admin')
    OR employee_id::text = current_setting('app.user_id', true)
  );

DROP POLICY IF EXISTS login_system ON login_attempts;
CREATE POLICY login_system ON login_attempts FOR ALL
  USING (current_setting('app.role', true) = 'system')
  WITH CHECK (current_setting('app.role', true) = 'system');
