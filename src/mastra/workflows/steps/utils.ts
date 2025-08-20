// Utility functions for GitHub API interactions

export const buildHeaders = (token?: string, requiresAuth = false): Record<string, string> => {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'samba-workflow',
  };
  
  if (token) {
    headers['Authorization'] = `token ${token}`;
  } else if (requiresAuth) {
    throw new Error('GitHub token required for this operation');
  }
  
  return headers;
};

export const throwIfNotOk = async (response: Response): Promise<void> => {
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
      const errorBody = await response.text();
      if (errorBody) {
        errorMessage += ` - ${errorBody}`;
      }
    } catch {
      // Ignore errors when reading response body
    }
    throw new Error(errorMessage);
  }
};

export const encodePath = (path: string): string => {
  return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
};

export const generateRunId = (): string => {
  return `${Date.now()}-${Math.floor(Math.random() * 1e9).toString(36)}`;
};
