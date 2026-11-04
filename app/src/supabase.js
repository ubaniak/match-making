import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

export const VIEW_AS_READ_ONLY = 'View as is read-only: you can see what they see, but nothing can be changed. Click "Back to my account" first.'

// While a site Admin uses View as (migration 44), the database runs their requests read-only and
// refuses any change with "cannot execute … in a read-only transaction". Say that in plain words.
async function viewAsFetch(input, init) {
  const response = await fetch(input, init)
  if (response.ok) return response
  const text = await response.clone().text()
  if (!/read-only transaction/i.test(text)) return response
  let body
  try {
    body = { ...JSON.parse(text), message: VIEW_AS_READ_ONLY }
  } catch {
    body = { message: VIEW_AS_READ_ONLY }
  }
  return new Response(JSON.stringify(body), { status: response.status, statusText: response.statusText, headers: response.headers })
}

export const supabase = isConfigured ? createClient(url, anonKey, { global: { fetch: viewAsFetch } }) : null
