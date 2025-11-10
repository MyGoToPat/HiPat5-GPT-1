-- Fix get_user_day_boundaries to use midnight (00:00:00) instead of 12:01 AM
-- This aligns macro reset with calendar days

CREATE OR REPLACE FUNCTION get_user_day_boundaries(
  p_user_id uuid,
  p_local_date date DEFAULT NULL
)
RETURNS TABLE(day_start timestamptz, day_end timestamptz)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_timezone text;
  v_local_date date;
BEGIN
  -- Get user's timezone with proper fallback
  SELECT COALESCE(up.timezone, 'America/New_York')
  INTO v_timezone
  FROM user_preferences up
  WHERE up.user_id = p_user_id;

  -- If user has no preferences row, default to America/New_York
  IF v_timezone IS NULL THEN
    v_timezone := 'America/New_York';
    RAISE NOTICE 'No timezone found for user %, defaulting to America/New_York', p_user_id;
  END IF;

  -- Use provided date or calculate today in user's timezone
  IF p_local_date IS NOT NULL THEN
    v_local_date := p_local_date;
  ELSE
    v_local_date := (now() AT TIME ZONE v_timezone)::date;
  END IF;

  -- Calculate boundaries: MIDNIGHT (00:00:00) to 11:59:59.999 PM in user's local timezone
  -- CHANGED: Using 00:00:00 as start (midnight) and 23:59:59.999 as end
  RETURN QUERY
  SELECT
    (v_local_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_timezone AS day_start,
    (v_local_date::text || ' 23:59:59.999')::timestamp AT TIME ZONE v_timezone AS day_end;

  RAISE NOTICE 'Calculated boundaries for user % (tz=%): start=%, end=%',
    p_user_id, v_timezone,
    (v_local_date::text || ' 00:00:00')::timestamp AT TIME ZONE v_timezone,
    (v_local_date::text || ' 23:59:59.999')::timestamp AT TIME ZONE v_timezone;
END;
$$;

