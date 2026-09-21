import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const supabaseUrl = import.meta.env.VITE_STAGING_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_STAGING_SUPABASE_PUBLISHABLE_KEY

const banner = document.createElement('div')
banner.setAttribute('role', 'status')
banner.textContent = 'Restricted staging · Real call samples + synthetic examples · Reviews stay here · Integrations disabled'
banner.style.cssText = 'background:#1D212F;color:#fff;padding:8px 16px;text-align:center;font:700 14px Inter,system-ui,sans-serif;letter-spacing:.05em;text-transform:uppercase'
document.body.prepend(banner)

/** Supabase client used only by validated `staging` Vite builds. */
export const supabase = createClient<Database>(supabaseUrl, supabasePublishableKey, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
})
