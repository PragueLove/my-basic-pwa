import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://ebyyrppkpxpfchmbwfxz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVieXlycHBrcHhwZmNobWJ3Znh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ1OTk2MTUsImV4cCI6MjA2MDE3NTYxNX0.hbB3tN7XvcIcRch1FpEMB3H4wEXy4wz9NNca3inQ5MA'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
})

export default supabase 