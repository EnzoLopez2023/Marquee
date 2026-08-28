import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMsal } from '@azure/msal-react';
import { getLoginRequest } from '../auth/msalConfig.js';
import { featureIsReadOnly } from '../auth/permissions.js';

type Role = 'viewer' | 'duplicate_delete' | 'admin';

interface PermissionState {
  loading: boolean;
  roles: Role[];
  hasRole(role: Role): boolean;
  canEdit(feature: string): boolean;
  isHidden(feature: string): boolean;
}

const PermissionContext = createContext<PermissionState>({
  loading: true,
  roles: [],
  hasRole: () => false,
  canEdit: () => false,
  isHidden: () => false,
});

export function UserPermissionsProvider({ children }: { children: ReactNode }) {
  const { instance } = useMsal();
  const [roles, setRoles] = useState<Role[]>([]);
  const [features, setFeatures] = useState<Record<string, { canEdit: boolean; isHidden: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const account = instance.getActiveAccount() ?? instance.getAllAccounts()[0];
      if (!account) return;
      try {
        const token = await instance.acquireTokenSilent({ ...getLoginRequest(), account });
        const response = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token.accessToken}` },
        });
        if (!response.ok) throw new Error(`Permissions request failed (${response.status})`);
        const data = await response.json() as {
          roles?: Role[];
          features?: Array<{ feature: string; can_edit: number; is_hidden: number }>;
        };
        if (active) {
          setRoles(Array.isArray(data.roles) ? data.roles : ['viewer']);
          setFeatures(Object.fromEntries((data.features ?? []).map((feature) => [
            feature.feature,
            { canEdit: Boolean(feature.can_edit), isHidden: Boolean(feature.is_hidden) },
          ])));
        }
      } catch {
        if (active) setRoles(['viewer']);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [instance]);

  const value = useMemo<PermissionState>(() => ({
    loading,
    roles,
    hasRole: (role) => roles.includes('admin') || roles.includes(role),
    canEdit: (feature) => roles.includes('admin') || Boolean(features[feature]?.canEdit),
    isHidden: (feature) => !roles.includes('admin') && Boolean(features[feature]?.isHidden),
  }), [features, loading, roles]);
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export const useUserPermissions = () => useContext(PermissionContext);
export function useReadOnly(feature?: string) {
  const { loading, hasRole, canEdit } = useUserPermissions();
  const normalized = feature === 'halloween' ? 'plex-library' : feature ?? '';
  return featureIsReadOnly({
    loading,
    duplicateFeature: feature === 'plex-command-center',
    hasDeleteRole: hasRole('duplicate_delete'),
    hasFeatureEdit: canEdit(normalized),
  });
}
