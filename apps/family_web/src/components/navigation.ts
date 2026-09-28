import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * `context.pop()` for the browser. Goes back when there is somewhere inside the
 * app to go back to; otherwise — a deep link opened in a fresh tab — goes to
 * `fallback` rather than off the site.
 */
export function useGoBack(fallback = '/') {
  const navigate = useNavigate();
  const location = useLocation();
  return useCallback(() => {
    if (location.key !== 'default' && window.history.length > 1) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate, location.key, fallback]);
}
