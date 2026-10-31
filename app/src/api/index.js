import { isConfigured } from '../supabase'
import { mockApi } from './mockApi'
import { supabaseApi } from './supabaseApi'

// Without Supabase settings the app runs in demo mode against mock data.
export const api = isConfigured ? supabaseApi : mockApi
