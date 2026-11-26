insert into ai_models (id, provider, task, model, unit_cost_credits) values
  ('openai:transcription', 'openai', 'transcription', 'gpt-4o-mini-transcribe', 1)
on conflict (id) do nothing;
