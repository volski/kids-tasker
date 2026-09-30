import { getAuth } from 'firebase/auth';

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  try {
    const auth = getAuth();
    if (auth && auth.currentUser) {
      const token = await auth.currentUser.getIdToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
  } catch (e) {
    // Ignore if Firebase Auth is not ready
  }

  const deviceToken = localStorage.getItem('kids_tasker_device_token');
  if (deviceToken && !headers['Authorization']) {
    headers['X-Device-Token'] = deviceToken;
  }

  if (sessionStorage.getItem('kids_tasker_parent_unlocked') === '1') {
    headers['X-Parent-Unlocked'] = '1';
  }

  const householdId = localStorage.getItem('kids_tasker_household_id');
  if (householdId) {
    headers['X-Household-Id'] = householdId;
  }

  return headers;
}

export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const customHeaders = (init.headers as Record<string, string>) || {};
  const mergedHeaders = {
    ...authHeaders,
    ...customHeaders
  };
  return fetch(url, {
    ...init,
    headers: mergedHeaders
  });
}
