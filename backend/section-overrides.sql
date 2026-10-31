-- Add timestamped section assignments without changing existing records.
begin;
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
commit;
