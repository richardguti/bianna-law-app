import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://aparjezcomoxlbicyegm.supabase.co'
const supabaseAnon = 'sb_publishable_TUA0hjz30OJKAEWV8cyMEw_sZIixly8'
const supabase = createClient(supabaseUrl, supabaseAnon)

async function test() {
  const { data, error } = await supabase.from('courses').insert({
    user_id: '00000000-0000-0000-0000-000000000001',
    name: 'Test Course',
    semester: 'Spring 2026'
  }).select().single()

  console.log('Data:', data)
  console.log('Error:', error)
}
test()
