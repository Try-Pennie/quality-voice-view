-- Enable Supabase Realtime for the notification bell. The existing RLS
-- SELECT policy (recipient_email = auth email) already gates what each
-- subscriber receives, so no new policy is required. REPLICA IDENTITY FULL
-- lets UPDATE events (read_at changes) carry the full old row over the wire.

alter publication supabase_realtime add table public.eavesly_notifications;
alter table public.eavesly_notifications replica identity full;
