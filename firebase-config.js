import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getMessaging, isSupported } from 'firebase/messaging';

export const firebaseConfig = {
  apiKey: 'AIzaSyC0AQ3rkH-fhxlThobjDDtrvxttAfFLXTE',
  authDomain: 'bayango-315c6.firebaseapp.com',
  databaseURL: 'https://bayango-315c6-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'bayango-315c6',
  storageBucket: 'bayango-315c6.firebasestorage.app',
  messagingSenderId: '199013441811',
  appId: '1:199013441811:web:315a38f03ddc9b676e3ae6',
  measurementId: 'G-1EEGFZWB7E',
};

export const WEB_PUSH_VAPID_KEY =
  'BMdJvRjBWkB8Ob6OOJNiaFVtKkTG4Ubd1BEM4z8VshMVO0WiGHYUEu3mfm1sQYlK25OloE9jjojJUWB12eMfLfA';

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getDatabase(app);

export async function getMessagingIfSupported() {
  if (typeof window === 'undefined') return null;
  const supported = await isSupported();
  return supported ? getMessaging(app) : null;
}
