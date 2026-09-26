"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { compileCustom, CustomColumn } from '@/lib/metrics/formula';

/** Colunas personalizadas do usuário, guardadas em custom_columns. */
export function useCustomColumns(supabase: SupabaseClient) {
  const [columns, setColumns] = useState<CustomColumn[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('custom_columns')
      .select('id, name, formula, format').order('created_at');
    if (error) {
      setError(/custom_columns/.test(error.message)
        ? 'Rode migration_colunas_filtros.sql no Supabase para criar colunas personalizadas.'
        : error.message);
      return;
    }
    setError(null);
    setColumns((data || []) as CustomColumn[]);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async (col: Omit<CustomColumn, 'id'> & { id?: string }): Promise<{ error: string | null; column?: CustomColumn }> => {
    const row = { name: col.name.trim(), formula: col.formula.trim(), format: col.format, updated_at: new Date().toISOString() };
    const { data, error } = col.id
      ? await supabase.from('custom_columns').update(row).eq('id', col.id).select('id, name, formula, format').single()
      : await supabase.from('custom_columns').insert(row).select('id, name, formula, format').single();
    if (error) return { error: error.message };
    setColumns(prev => col.id ? prev.map(c => (c.id === col.id ? data as CustomColumn : c)) : [...prev, data as CustomColumn]);
    return { error: null, column: data as CustomColumn };
  }, [supabase]);

  const remove = useCallback(async (id: string): Promise<string | null> => {
    const { error } = await supabase.from('custom_columns').delete().eq('id', id);
    if (error) return error.message;
    setColumns(prev => prev.filter(c => c.id !== id));
    return null;
  }, [supabase]);

  const compiled = useMemo(() => compileCustom(columns), [columns]);

  return { columns, compiled, save, remove, error };
}

export type CustomColumnsApi = ReturnType<typeof useCustomColumns>;
