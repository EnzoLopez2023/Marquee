import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { apiClient } from './apiClient.js';

interface ImageEntry {
  refs: number;
  promise: Promise<string>;
  objectUrl?: string;
}

const cache = new Map<string, ImageEntry>();

export function acquireAuthenticatedImage(source: string) {
  let entry = cache.get(source);
  if (!entry) {
    entry = {
      refs: 0,
      promise: apiClient.fetch(source)
        .then(async (response: Response) => {
          if (!response.ok) throw new Error(`Image request failed (${response.status})`);
          const objectUrl = URL.createObjectURL(await response.blob());
          const current = cache.get(source);
          if (current && current === entry) current.objectUrl = objectUrl;
          else URL.revokeObjectURL(objectUrl);
          return objectUrl;
        })
        .catch((error: unknown) => {
          const current = cache.get(source);
          if (current?.refs === 0) cache.delete(source);
          throw error;
        }),
    };
    cache.set(source, entry);
  }
  entry.refs += 1;
  return entry.promise;
}

export function releaseAuthenticatedImage(source: string) {
  const entry = cache.get(source);
  if (!entry) return;
  entry.refs = Math.max(0, entry.refs - 1);
  if (entry.refs === 0) {
    cache.delete(source);
    if (entry.objectUrl) URL.revokeObjectURL(entry.objectUrl);
  }
}

export function useAuthenticatedImageUrl(source?: string | null) {
  const [objectUrl, setObjectUrl] = useState<string>();
  useEffect(() => {
    if (!source) {
      setObjectUrl(undefined);
      return;
    }
    let active = true;
    setObjectUrl(undefined);
    void acquireAuthenticatedImage(source)
      .then((url) => { if (active) setObjectUrl(url); })
      .catch(() => { if (active) setObjectUrl(undefined); });
    return () => {
      active = false;
      releaseAuthenticatedImage(source);
    };
  }, [source]);
  return objectUrl;
}

export function AuthenticatedImage({
  source,
  ...props
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { source: string }) {
  const objectUrl = useAuthenticatedImageUrl(source);
  if (!objectUrl) return null;
  return <img {...props} src={objectUrl} />;
}
