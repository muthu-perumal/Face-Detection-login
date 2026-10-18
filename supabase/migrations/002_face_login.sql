ALTER TABLE verification_challenges ALTER COLUMN employee_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION list_login_templates()
RETURNS TABLE (employee_id UUID, encrypted_template TEXT)
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
    SELECT f.employee_id, f.encrypted_template
    FROM face_enrollments f
    JOIN profiles p ON p.id = f.employee_id
    WHERE f.status = 'active' AND p.status = 'active';
END $$;

REVOKE ALL ON FUNCTION list_login_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_login_templates() TO app_user;
