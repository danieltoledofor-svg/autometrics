"use client";

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Preferências das tabelas, salvas no usuário (tabela user_ui_prefs): largura
 * das colunas, densidade e colunas visíveis. Valem em qualquer computador.
 *
 * Uma cópia fica no navegador para a tabela abrir já do jeito certo enquanto o
 * banco responde — e para seguir funcionando antes da migration.
 */

export type Density = 'compact' | 'comfortable';

interface TablePrefs {
  widths?: Record<string, number>;
  density?: Density;
  columns?: string[];
}
interface Prefs {
  tables?: Record<string, TablePrefs>;
}

const LOCAL_KEY = 'autometrics_ui_prefs';

let state: Prefs = {};
let loaded = false;
let loading = false;
let userId: string | null = null;
let dbAvailable = true;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
/** Colunas escolhidas antes, no navegador (chave antiga), por tabela. */
const legacyKeys = new Map<string, string>();

/** Só depois de ler o banco: a escolha antiga do navegador não pode sobrescrever a do usuário. */
function migrateLegacy() {
  if (!loaded) return;
  for (const [tableId, key] of legacyKeys) {
    legacyKeys.delete(tableId);
    if (state.tables?.[tableId]?.columns) continue;
    try {
      const raw = localStorage.getItem(key);
      const cols = raw ? JSON.parse(raw) : null;
      if (Array.isArray(cols) && cols.length) update(tableId, { columns: cols });
    } catch { /* ignora */ }
  }
}

function emit() { for (const l of listeners) l(); }

function readLocal(): Prefs {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}
function writeLocal(p: Prefs) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(p)); } catch { /* sem armazenamento */ }
}

async function load() {
  if (loaded || loading || typeof window === 'undefined') return;
  loading = true;
  state = readLocal();
  emit();
  try {
    const { data: { session } } = await supabase.auth.getSession();
    userId = session?.user?.id || null;
    if (userId) {
      const { data, error } = await supabase.from('user_ui_prefs').select('prefs').eq('user_id', userId).maybeSingle();
      if (error) dbAvailable = false;
      else if (data?.prefs) { state = data.prefs as Prefs; writeLocal(state); }
      // Primeira vez: leva para o banco o que já estava no navegador.
      else if (Object.keys(state.tables || {}).length) scheduleSave();
    }
  } catch { dbAvailable = false; }
  loaded = true;
  loading = false;
  emit();
  migrateLegacy();
}

function scheduleSave() {
  writeLocal(state);
  if (!dbAvailable || !userId) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { error } = await supabase.from('user_ui_prefs')
      .upsert({ user_id: userId, prefs: state, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) dbAvailable = false;
  }, 800);
}

function update(tableId: string, patch: Partial<TablePrefs>) {
  const cur = state.tables?.[tableId] || {};
  state = { ...state, tables: { ...(state.tables || {}), [tableId]: { ...cur, ...patch } } };
  emit();
  scheduleSave();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => state;
// Mesmo objeto sempre: o React compara por referência e entra em loop se mudar.
const EMPTY: Prefs = {};
const serverSnapshot = () => EMPTY;

export function useTablePrefs(tableId: string, opts: { legacyColumnsKey?: string } = {}) {
  const prefs = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(() => {
    if (opts.legacyColumnsKey) legacyKeys.set(tableId, opts.legacyColumnsKey);
    load();
    migrateLegacy();
  }, [tableId, opts.legacyColumnsKey]);
  const t = prefs.tables?.[tableId] || {};

  const setWidth = useCallback((key: string, width: number | null) => {
    const widths = { ...(state.tables?.[tableId]?.widths || {}) };
    if (width === null) delete widths[key];
    else widths[key] = Math.round(width);
    update(tableId, { widths });
  }, [tableId]);

  return {
    widths: t.widths || {},
    setWidth,
    resetWidths: useCallback(() => update(tableId, { widths: {} }), [tableId]),
    density: (t.density || 'compact') as Density,
    setDensity: useCallback((density: Density) => update(tableId, { density }), [tableId]),
    columns: t.columns,
    setColumns: useCallback((columns: string[] | undefined) => update(tableId, { columns }), [tableId]),
  };
}

export type TablePrefsApi = ReturnType<typeof useTablePrefs>;
