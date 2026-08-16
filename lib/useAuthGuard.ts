"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabaseClient';

/**
 * Blocks page rendering until Supabase session is confirmed.
 * Redirects to '/' if the user is not authenticated.
 *
 * Returns `authChecked: true` only after a valid session is found.
 * Render nothing (or a blank screen) while `authChecked` is false.
 */
export function useAuthGuard() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/');
      } else {
        setAuthChecked(true);
      }
    });
  }, [router]);

  return { authChecked };
}
