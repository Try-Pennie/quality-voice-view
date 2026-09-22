/** Fixed-channel, chat:write-only Slack transport; never log its config. */
export type AchieveSlackConfig = {
  readonly token: string
  readonly channel: string
}

export function parseAchieveSlackConfig(
  readEnv: (name: string) => string | undefined,
): AchieveSlackConfig | null {
  if (readEnv('ACHIEVE_SLACK_ALERTS_ENABLED') !== 'true') return null
  const token = readEnv('ACHIEVE_SLACK_BOT_TOKEN') ?? ''
  const channel = readEnv('ACHIEVE_SLACK_CHANNEL_ID') ?? ''
  return /^xoxb-[A-Za-z0-9-]+$/.test(token) && /^[CG][A-Z0-9]{8,}$/.test(channel)
    ? { token, channel }
    : null
}

/** HTTP 200 is not Slack success: require ok:true and the configured channel. */
export async function postAchieveSlackAlert(
  config: AchieveSlackConfig,
  text: string,
  options: { readonly signal: AbortSignal },
  transport: typeof fetch = fetch,
): Promise<'sent' | 'failed' | 'cancelled'> {
  try {
    const response = await transport('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      // Workers supports manual, not error; non-2xx below rejects redirects.
      redirect: 'manual',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: config.channel, text, unfurl_links: false, unfurl_media: false }),
      signal: options.signal,
    })
    if (!response.ok) return 'failed'
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      && 'ok' in body && body.ok === true && 'channel' in body && body.channel === config.channel
      ? 'sent' : 'failed'
  } catch {
    return options.signal.aborted ? 'cancelled' : 'failed'
  }
}
