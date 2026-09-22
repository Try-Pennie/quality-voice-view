import { supabase } from '@/integrations/supabase/client'
import type { EavlNotification } from '@/types/database'
import { SUPPRESSED_ALERT_MODULES, filterSuppressedAlertRows } from './suppressed-alerts'


// Recent notifications for the bell dropdown. Read + unread, newest first.
// RLS scopes to the caller's recipient_email automatically; we still pass
// the email so the query key changes per-user across sign-outs.
export async function fetchRecentNotifications(
  email: string,
  limit = 30,
): Promise<EavlNotification[]> {
  if (!email) return []
  let q = supabase
    .from('eavesly_notifications' as never)
    .select('*')
    .eq('recipient_email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(limit)

  // Keep production-test disposition-review notifications out of the manager
  // bell feed until the alert type is ready for review.
  for (const moduleName of SUPPRESSED_ALERT_MODULES) {
    q = q.neq('module_name', moduleName)
  }

  const { data, error } = await q
  if (error) {
    console.error('Error fetching notifications:', error)
    throw error
  }
  return filterSuppressedAlertRows(data as EavlNotification[])
}

export async function markNotificationsRead(
  ids: number[],
): Promise<{ ok: boolean; error?: string }> {
  if (ids.length === 0) return { ok: true }
  const { error } = await supabase
    .from('eavesly_notifications' as never)
    .update({ read_at: new Date().toISOString() } as never)
    .in('id', ids)
    .is('read_at', null)
  if (error) {
    console.error('Error marking notifications read:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function markAllNotificationsRead(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!email) return { ok: true }
  const { error } = await supabase
    .from('eavesly_notifications' as never)
    .update({ read_at: new Date().toISOString() } as never)
    .eq('recipient_email', email.toLowerCase())
    .is('read_at', null)
  if (error) {
    console.error('Error clearing notifications:', error)
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
