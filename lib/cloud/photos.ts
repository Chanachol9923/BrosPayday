'use client';

import { supabase } from '../supabase/client';

/**
 * Photo blobs in Supabase Storage.
 *
 * The bucket is private, so nothing is served by a plain URL — every read is a
 * signed link that expires. IndexedDB stays in front of it as a cache, which is
 * what makes a party you already opened work with no signal.
 *
 * Paths carry their own authorisation:
 *   <party_id>/<photo_id>      a receipt, readable by the party's crew
 *   crew/<group_id>/<photo_id> a payment QR, readable by that crew
 */

const BUCKET = 'party-photos';
const SIGNED_URL_TTL = 60 * 60; // an hour is plenty for one sitting

export function receiptPath(partyId: string, photoId: string): string {
  return `${partyId}/${photoId}`;
}

export function crewPath(groupId: string, photoId: string): string {
  return `crew/${groupId}/${photoId}`;
}

export async function uploadPhoto(path: string, blob: Blob): Promise<void> {
  const db = supabase();
  if (!db) return;

  const { error } = await db.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;
}

export async function downloadPhoto(path: string): Promise<Blob | null> {
  const db = supabase();
  if (!db) return null;

  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error) return null;
  return data;
}

export async function signedPhotoUrl(path: string): Promise<string | null> {
  const db = supabase();
  if (!db) return null;

  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export async function removePhoto(path: string): Promise<void> {
  const db = supabase();
  if (!db) return;
  await db.storage.from(BUCKET).remove([path]);
}
