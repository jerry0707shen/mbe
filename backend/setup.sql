-- Run once in a dedicated Supabase project's SQL editor. Re-running is safe.
-- No user data is embedded. Auth users, rows, and files remain private.
begin;

create table if not exists public.mbe_documents (
  user_id uuid not null references auth.users(id) on delete cascade,
  doc_key text not null check (doc_key ~ '^(q_[A-Z]+_[0-9]+|s_[A-Za-z0-9_-]+|cfg)$'),
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 4194304),
  updated_at timestamptz not null default now(),
  primary key(user_id, doc_key)
);
alter table public.mbe_documents enable row level security;
revoke all on public.mbe_documents from public, anon, authenticated;
grant select, insert, update on public.mbe_documents to authenticated;
drop policy if exists mbe_documents_owner on public.mbe_documents;
create policy mbe_documents_owner on public.mbe_documents to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Combine independent attempts and timestamped edits inside one atomic upsert.
-- A device cannot overwrite another device's attempts with an older snapshot.
create or replace function public.mbe_merge_record(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb := coalesce(a, '{}'::jsonb); attempts jsonb; field text;
begin
  select coalesce(jsonb_agg(v order by (v->>1)::numeric, v->>0), '[]'::jsonb) into attempts
    from (
      select distinct on (v->>0) v
      from jsonb_array_elements(coalesce(a->'a','[]'::jsonb) || coalesce(b->'a','[]'::jsonb)) with ordinality as e(v,n)
      order by v->>0, n
    ) events;
  result := jsonb_set(result, '{a}', attempts);
  foreach field in array array['r','n','f','w','g'] loop
    if b ? field and (not (result ? field) or (b->field->>1)::numeric > (result->field->>1)::numeric) then
      result := jsonb_set(result, array[field], b->field);
    end if;
  end loop;
  if not (result ? 'h') and b ? 'h' then result := jsonb_set(result, '{h}', b->'h'); end if;
  return result;
end $$;

create or replace function public.mbe_merge_document(a jsonb, b jsonb, k text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare records jsonb := coalesce(a->'recs','{}'::jsonb); q text; r jsonb;
begin
  if a is null then return b; end if;
  if k like 'q\_%' escape '\' then
    for q,r in select key,value from jsonb_each(coalesce(b->'recs','{}'::jsonb)) loop
      records := jsonb_set(records, array[q], public.mbe_merge_record(records->q,r));
    end loop;
    return jsonb_build_object('recs',records,'u',greatest(coalesce((a->>'u')::numeric,0),coalesce((b->>'u')::numeric,0)));
  end if;
  if coalesce((b->>'u')::numeric,0) > coalesce((a->>'u')::numeric,0) then return b; end if;
  return a;
end $$;

create or replace function public.mbe_save_document(p_key text, p_body jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid(); result jsonb;
begin
  if uid is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  insert into public.mbe_documents(user_id, doc_key, body) values(uid, p_key, p_body)
    on conflict(user_id, doc_key) do update
      set body = public.mbe_merge_document(public.mbe_documents.body, excluded.body, p_key), updated_at = now()
    returning body into result;
  return result;
end $$;
revoke all on function public.mbe_merge_record(jsonb,jsonb) from public;
revoke all on function public.mbe_merge_document(jsonb,jsonb,text) from public;
revoke all on function public.mbe_save_document(text,jsonb) from public;
grant execute on function public.mbe_merge_record(jsonb,jsonb) to authenticated;
grant execute on function public.mbe_merge_document(jsonb,jsonb,text) to authenticated;
grant execute on function public.mbe_save_document(text,jsonb) to authenticated;

create table if not exists public.mbe_library (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (code in ('CON','TOR','CRL','CRP','EVI','CIV','CL','RP','NCBE')),
  file_name text not null,
  bank_path text not null,
  bank_sha256 text not null check (bank_sha256 ~ '^[0-9a-f]{64}$'),
  pdf_path text,
  pdf_sha256 text check (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  size bigint not null check (size >= 0),
  updated_at timestamptz not null default now(),
  primary key(user_id,code),
  check (bank_path = user_id::text || '/' || code || '/' || bank_sha256 || '.json'),
  check ((pdf_path is null and pdf_sha256 is null) or
    (pdf_path is not null and pdf_sha256 is not null and pdf_path = user_id::text || '/' || code || '/' || pdf_sha256 || '.pdf'))
);
alter table public.mbe_library enable row level security;
revoke all on public.mbe_library from public, anon, authenticated;
grant select, insert, update on public.mbe_library to authenticated;
drop policy if exists mbe_library_owner on public.mbe_library;
create policy mbe_library_owner on public.mbe_library to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('mbe-private','mbe-private',false,52428800,array['application/pdf','application/json'])
on conflict(id) do update set public=false, file_size_limit=52428800,
  allowed_mime_types=array['application/pdf','application/json'];
drop policy if exists mbe_private_read on storage.objects;
create policy mbe_private_read on storage.objects for select to authenticated using (
  bucket_id='mbe-private' and (storage.foldername(name))[1]=(select auth.uid())::text
);
drop policy if exists mbe_private_insert on storage.objects;
create policy mbe_private_insert on storage.objects for insert to authenticated with check (
  bucket_id='mbe-private' and (storage.foldername(name))[1]=(select auth.uid())::text
);
-- Immutable objects deliberately have no client UPDATE or DELETE policy.
commit;
