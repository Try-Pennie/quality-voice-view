import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, MessageSquare, CheckCheck, AlertCircle } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useAuth } from '../hooks/useAuth'
import { useNotifications, useNotificationsRealtime } from '../hooks/use-queries'
import {
  markNotificationsRead,
  markAllNotificationsRead,
} from '../lib/notification-queries'
import type { EavlNotification, NotificationKind } from '../types/database'

const KIND_LABEL: Record<NotificationKind, string> = {
  alert_message: 'replied on an alert',
  alert_ack_required: 'wants you to reply',
  alert_ack: 'marked an alert reviewed',
}

function KindIcon({ kind }: { kind: NotificationKind }) {
  if (kind === 'alert_ack')
    return <CheckCheck className="w-4 h-4 text-pennie-green-dark" aria-hidden="true" />
  if (kind === 'alert_ack_required')
    return <AlertCircle className="w-4 h-4 text-pennie-peach-dark" aria-hidden="true" />
  return <MessageSquare className="w-4 h-4 text-pennie-blue-dark" aria-hidden="true" />
}

function emailLabel(email: string): string {
  return email.split('@')[0] || email
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.round(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

export function NotificationBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data, isError } = useNotifications(user?.email)
  useNotificationsRealtime(user?.email)
  const notifications = useMemo<EavlNotification[]>(() => data ?? [], [data])
  const unreadCount = useMemo(
    () => notifications.filter(n => n.read_at === null).length,
    [notifications],
  )

  const onClickRow = async (n: EavlNotification) => {
    // Optimistic local mark-read so the badge drops immediately.
    queryClient.setQueryData<EavlNotification[]>(
      ['notifications', user?.email],
      old =>
        old?.map(row =>
          row.id === n.id ? { ...row, read_at: new Date().toISOString() } : row,
        ),
    )
    if (n.read_at === null) {
      void markNotificationsRead([n.id]).then(() => {
        queryClient.invalidateQueries({ queryKey: ['notifications', user?.email] })
      })
    }
    navigate(`/dashboard/alerts/${n.call_id}/${n.module_name}`)
  }

  const onClearAll = async () => {
    if (!user?.email) return
    queryClient.setQueryData<EavlNotification[]>(
      ['notifications', user.email],
      old =>
        old?.map(row =>
          row.read_at === null
            ? { ...row, read_at: new Date().toISOString() }
            : row,
        ),
    )
    await markAllNotificationsRead(user.email)
    queryClient.invalidateQueries({ queryKey: ['notifications', user.email] })
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : 'Notifications'
          }
          className="pennie-focus-ring relative min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-full text-pennie-graphite/70 hover:text-pennie-navy hover:bg-pennie-beige transition-colors"
        >
          <Bell className="w-4 h-4" aria-hidden="true" />
          {unreadCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-pennie-peach-dark text-pennie-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
              aria-hidden="true"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0 max-h-[28rem] flex flex-col">
        <header className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-sm font-semibold text-pennie-navy">Notifications</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-semibold text-pennie-blue-deeper hover:underline underline-offset-4"
            >
              Mark all read
            </button>
          )}
        </header>
        <div className="flex-1 overflow-y-auto">
          {isError ? (
            <p className="px-4 py-8 text-sm text-pennie-peach-dark text-center">
              Couldn't load notifications. They'll refresh automatically.
            </p>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-8 text-sm text-pennie-graphite/60 text-center">
              You're all caught up.
            </p>
          ) : (
            <ul>
              {notifications.map(n => {
                const unread = n.read_at === null
                const snippet =
                  (n.payload_json && typeof n.payload_json.snippet === 'string'
                    ? n.payload_json.snippet
                    : '') || ''
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onClickRow(n)}
                      className={`w-full text-left px-4 py-3 border-b border-border/60 last:border-b-0 hover:bg-pennie-beige/60 focus:outline-none focus:bg-pennie-beige/80 transition-colors ${
                        unread ? 'bg-pennie-blue-light/40' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex-none">
                          <KindIcon kind={n.kind} />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-pennie-graphite leading-snug">
                            <span className="font-semibold text-pennie-navy">
                              {emailLabel(n.source_actor_email)}
                            </span>{' '}
                            {KIND_LABEL[n.kind]}
                          </p>
                          {snippet && (
                            <p className="mt-0.5 text-xs text-pennie-graphite/70 line-clamp-2">
                              "{snippet}"
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-pennie-graphite/60 tabular-nums">
                            {formatRelative(n.created_at)}
                          </p>
                        </div>
                        {unread && (
                          <span
                            className="mt-1.5 w-2 h-2 rounded-full bg-pennie-blue-dark flex-none"
                            aria-label="Unread"
                          />
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
