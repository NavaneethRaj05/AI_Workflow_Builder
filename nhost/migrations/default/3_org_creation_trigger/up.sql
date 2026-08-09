CREATE OR REPLACE FUNCTION public.set_org_owner()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id uuid;
BEGIN
  -- Get user_id from Hasura session (works in Nhost GraphQL mutations)
  BEGIN
    v_user_id := (current_setting('hasura.user', 't')::json->>'x-hasura-user-id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;
  
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (NEW.id, v_user_id, 'owner');
  END IF;
  
  RETURN NEW;
END;
$function$;

CREATE TRIGGER set_org_owner_trigger
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_org_owner();
