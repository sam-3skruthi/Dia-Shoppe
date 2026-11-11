import { supabase } from './supabase'

/*
  Admin co-pilot — asks the `assistant` Edge Function a question and gets back
  an answer plus a live store-health snapshot. Works even without AI credits
  (the function returns a rule-based summary in that case).
*/
export async function askAssistant(question) {
  const { data, error } = await supabase.functions.invoke('assistant', {
    body: { question: question || '' },
  })
  if (error) return { error: error.message }
  return { ...data } // { answer, ai, health }
}
