-- =============================================================================
-- Functions, triggers, Row Level Security.
--
-- This migration is the database-level half of CareBridge's authorization. The
-- application `authz` layer is the primary control; everything here is defence
-- in depth, and is exercised as the `authenticated`/`anon` roles by the RLS
-- test suite (tests/integration).
--
-- Design notes:
--  * Authorization helpers are SECURITY DEFINER with an empty search_path. They
--    run as the owner and therefore bypass RLS, which both avoids policy
--    recursion (a policy on family_members that needs to read family_members)
--    and keeps the logic in one auditable place.
--  * Role at signup is read ONLY from app_metadata (server/service-role
--    controlled), never user_metadata (client controlled). Self-service signup
--    is always FAMILY; caregivers and admins are provisioned by operations.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.family_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.caregiver_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.caregiver_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.senior_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.consents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.ride_details
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.caregiver_assignments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.task_checklists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.payment_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- New auth user -> public.users (+ family account / caregiver profile)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_role;
  v_display text;
  v_account_name text;
  v_account_id uuid;
BEGIN
  -- Trust app_metadata for role (service-role controlled), never user_metadata.
  v_role := COALESCE((NEW.raw_app_meta_data->>'role')::public.app_role, 'FAMILY');
  v_display := NULLIF(NEW.raw_user_meta_data->>'display_name', '');
  v_account_name := COALESCE(NULLIF(NEW.raw_user_meta_data->>'account_name', ''), 'My family');

  INSERT INTO public.users (id, email, role, display_name)
  VALUES (NEW.id, NEW.email, v_role, v_display);

  IF v_role = 'FAMILY' THEN
    INSERT INTO public.family_accounts (name, created_by)
    VALUES (v_account_name, NEW.id)
    RETURNING id INTO v_account_id;

    INSERT INTO public.family_members (family_account_id, user_id, member_role)
    VALUES (v_account_id, NEW.id, 'OWNER');
  ELSIF v_role = 'CAREGIVER' THEN
    INSERT INTO public.caregiver_profiles (user_id, display_name, status)
    VALUES (NEW.id, COALESCE(v_display, 'Caregiver'), 'PENDING');
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER: bypass RLS, no recursion)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS public.app_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_ops()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT role FROM public.users WHERE id = auth.uid()) = 'OPERATIONS_ADMIN', false);
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_family_member(account uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.family_members m
    WHERE m.family_account_id = account AND m.user_id = auth.uid()
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.current_caregiver_profile_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.caregiver_profiles WHERE user_id = auth.uid();
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_assigned_caregiver(req uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.caregiver_assignments a
    JOIN public.caregiver_profiles c ON c.id = a.caregiver_profile_id
    WHERE a.service_request_id = req AND c.user_id = auth.uid()
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.is_caregiver_for_senior(senior uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.service_requests sr
    JOIN public.caregiver_assignments a ON a.service_request_id = sr.id
    JOIN public.caregiver_profiles c ON c.id = a.caregiver_profile_id
    WHERE sr.senior_profile_id = senior AND c.user_id = auth.uid()
  );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.can_read_request(req uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_ops()
    OR public.is_assigned_caregiver(req)
    OR EXISTS(
      SELECT 1 FROM public.service_requests sr
      WHERE sr.id = req AND public.is_family_member(sr.family_account_id)
    );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.can_manage_request_as_family(req uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.is_ops()
    OR EXISTS(
      SELECT 1 FROM public.service_requests sr
      WHERE sr.id = req AND public.is_family_member(sr.family_account_id)
    );
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.caregiver_owns_assignment(assignment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.caregiver_assignments a
    JOIN public.caregiver_profiles c ON c.id = a.caregiver_profile_id
    WHERE a.id = assignment AND c.user_id = auth.uid()
  );
$$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Grants. RLS default-denies, so broad DML grants are safe: without a matching
-- policy nothing is visible. anon receives grants but has no policies anywhere,
-- so a signed-out caller sees and does nothing.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.family_accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.caregiver_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.caregiver_availability ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.senior_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.ride_details ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.caregiver_assignments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.assignment_check_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.task_checklists ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.internal_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Policies. All scoped `TO authenticated`; anon has none and so sees nothing.
-- ---------------------------------------------------------------------------

-- users: self-read, ops read-all; role/profile updates are ops-only via RLS
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_ops());--> statement-breakpoint
CREATE POLICY users_update ON public.users FOR UPDATE TO authenticated
  USING (public.is_ops()) WITH CHECK (public.is_ops());--> statement-breakpoint

-- family_accounts
CREATE POLICY family_accounts_select ON public.family_accounts FOR SELECT TO authenticated
  USING (public.is_family_member(id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY family_accounts_insert ON public.family_accounts FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR public.is_ops());--> statement-breakpoint
CREATE POLICY family_accounts_update ON public.family_accounts FOR UPDATE TO authenticated
  USING (public.is_family_member(id) OR public.is_ops())
  WITH CHECK (public.is_family_member(id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY family_accounts_delete ON public.family_accounts FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- family_members
CREATE POLICY family_members_select ON public.family_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY family_members_insert ON public.family_members FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY family_members_delete ON public.family_members FOR DELETE TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint

-- caregiver_profiles: own or ops
CREATE POLICY caregiver_profiles_select ON public.caregiver_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_ops());--> statement-breakpoint
CREATE POLICY caregiver_profiles_insert ON public.caregiver_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_ops());--> statement-breakpoint
CREATE POLICY caregiver_profiles_update ON public.caregiver_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_ops())
  WITH CHECK (user_id = auth.uid() OR public.is_ops());--> statement-breakpoint
CREATE POLICY caregiver_profiles_delete ON public.caregiver_profiles FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- caregiver_availability: owning caregiver or ops
CREATE POLICY caregiver_availability_all ON public.caregiver_availability FOR ALL TO authenticated
  USING (caregiver_profile_id = public.current_caregiver_profile_id() OR public.is_ops())
  WITH CHECK (caregiver_profile_id = public.current_caregiver_profile_id() OR public.is_ops());--> statement-breakpoint

-- senior_profiles: family of the account, an assigned caregiver (read), or ops
CREATE POLICY senior_profiles_select ON public.senior_profiles FOR SELECT TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops() OR public.is_caregiver_for_senior(id));--> statement-breakpoint
CREATE POLICY senior_profiles_insert ON public.senior_profiles FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY senior_profiles_update ON public.senior_profiles FOR UPDATE TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops())
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY senior_profiles_delete ON public.senior_profiles FOR DELETE TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint

-- consents: family of the account or ops
CREATE POLICY consents_all ON public.consents FOR ALL TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops())
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint

-- service_requests
CREATE POLICY service_requests_select ON public.service_requests FOR SELECT TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops() OR public.is_assigned_caregiver(id));--> statement-breakpoint
CREATE POLICY service_requests_insert ON public.service_requests FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY service_requests_update ON public.service_requests FOR UPDATE TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops())
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY service_requests_delete ON public.service_requests FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- appointments: read follows request; family/ops manage
CREATE POLICY appointments_select ON public.appointments FOR SELECT TO authenticated
  USING (public.can_read_request(service_request_id));--> statement-breakpoint
CREATE POLICY appointments_insert ON public.appointments FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_request_as_family(service_request_id));--> statement-breakpoint
CREATE POLICY appointments_update ON public.appointments FOR UPDATE TO authenticated
  USING (public.can_manage_request_as_family(service_request_id))
  WITH CHECK (public.can_manage_request_as_family(service_request_id));--> statement-breakpoint
CREATE POLICY appointments_delete ON public.appointments FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- ride_details: read follows request; ops-only writes (entered manually by ops)
CREATE POLICY ride_details_select ON public.ride_details FOR SELECT TO authenticated
  USING (public.can_read_request(service_request_id));--> statement-breakpoint
CREATE POLICY ride_details_write ON public.ride_details FOR ALL TO authenticated
  USING (public.is_ops()) WITH CHECK (public.is_ops());--> statement-breakpoint

-- caregiver_assignments
CREATE POLICY caregiver_assignments_select ON public.caregiver_assignments FOR SELECT TO authenticated
  USING (
    public.is_ops()
    OR caregiver_profile_id = public.current_caregiver_profile_id()
    OR public.can_manage_request_as_family(service_request_id)
  );--> statement-breakpoint
CREATE POLICY caregiver_assignments_insert ON public.caregiver_assignments FOR INSERT TO authenticated
  WITH CHECK (public.is_ops());--> statement-breakpoint
CREATE POLICY caregiver_assignments_update ON public.caregiver_assignments FOR UPDATE TO authenticated
  USING (public.is_ops() OR caregiver_profile_id = public.current_caregiver_profile_id())
  WITH CHECK (public.is_ops() OR caregiver_profile_id = public.current_caregiver_profile_id());--> statement-breakpoint
CREATE POLICY caregiver_assignments_delete ON public.caregiver_assignments FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- assignment_check_events: append-only; owning caregiver or ops create/read; family read
CREATE POLICY assignment_check_events_select ON public.assignment_check_events FOR SELECT TO authenticated
  USING (
    public.is_ops()
    OR public.caregiver_owns_assignment(assignment_id)
    OR EXISTS(
      SELECT 1 FROM public.caregiver_assignments a
      WHERE a.id = assignment_id AND public.can_manage_request_as_family(a.service_request_id)
    )
  );--> statement-breakpoint
CREATE POLICY assignment_check_events_insert ON public.assignment_check_events FOR INSERT TO authenticated
  WITH CHECK (public.is_ops() OR public.caregiver_owns_assignment(assignment_id));--> statement-breakpoint

-- task_checklists
CREATE POLICY task_checklists_select ON public.task_checklists FOR SELECT TO authenticated
  USING (
    public.is_ops()
    OR public.caregiver_owns_assignment(assignment_id)
    OR EXISTS(
      SELECT 1 FROM public.caregiver_assignments a
      WHERE a.id = assignment_id AND public.can_manage_request_as_family(a.service_request_id)
    )
  );--> statement-breakpoint
CREATE POLICY task_checklists_insert ON public.task_checklists FOR INSERT TO authenticated
  WITH CHECK (public.is_ops() OR public.caregiver_owns_assignment(assignment_id));--> statement-breakpoint
CREATE POLICY task_checklists_update ON public.task_checklists FOR UPDATE TO authenticated
  USING (public.is_ops() OR public.caregiver_owns_assignment(assignment_id))
  WITH CHECK (public.is_ops() OR public.caregiver_owns_assignment(assignment_id));--> statement-breakpoint
CREATE POLICY task_checklists_delete ON public.task_checklists FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- incident_reports: ops, or the caregiver who filed it. NEVER families.
CREATE POLICY incident_reports_select ON public.incident_reports FOR SELECT TO authenticated
  USING (public.is_ops() OR reported_by = auth.uid());--> statement-breakpoint
CREATE POLICY incident_reports_insert ON public.incident_reports FOR INSERT TO authenticated
  WITH CHECK (public.is_ops() OR reported_by = auth.uid());--> statement-breakpoint
CREATE POLICY incident_reports_update ON public.incident_reports FOR UPDATE TO authenticated
  USING (public.is_ops()) WITH CHECK (public.is_ops());--> statement-breakpoint
CREATE POLICY incident_reports_delete ON public.incident_reports FOR DELETE TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- internal_notes: OPERATIONS ONLY. No family or caregiver access whatsoever.
CREATE POLICY internal_notes_all ON public.internal_notes FOR ALL TO authenticated
  USING (public.is_ops()) WITH CHECK (public.is_ops());--> statement-breakpoint

-- notification_events: ops read only. Writes happen via the trusted connection.
CREATE POLICY notification_events_select ON public.notification_events FOR SELECT TO authenticated
  USING (public.is_ops());--> statement-breakpoint

-- payment_records: family of the account or ops read/create; state updates ops-only
CREATE POLICY payment_records_select ON public.payment_records FOR SELECT TO authenticated
  USING (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY payment_records_insert ON public.payment_records FOR INSERT TO authenticated
  WITH CHECK (public.is_family_member(family_account_id) OR public.is_ops());--> statement-breakpoint
CREATE POLICY payment_records_update ON public.payment_records FOR UPDATE TO authenticated
  USING (public.is_ops()) WITH CHECK (public.is_ops());--> statement-breakpoint

-- audit_events: ops read only. No insert/update/delete policy => append-only for
-- everyone but the trusted connection (which writes them). Truly immutable via
-- the data API.
CREATE POLICY audit_events_select ON public.audit_events FOR SELECT TO authenticated
  USING (public.is_ops());--> statement-breakpoint
